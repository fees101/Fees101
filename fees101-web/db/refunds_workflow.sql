-- Refunds for automatic (Paystack) payments — real money moved, so this needs
-- its own workflow distinct from manual-payment "reversals" (db/manual_payment_entry.sql),
-- which only ever correct the internal ledger and explicitly refuse to touch a
-- provider-sourced payment row.
--
-- Reuses the pre-existing (previously unused) `refunds` table and the two
-- existing ledger-insert primitives from manual_payment_entry.sql
-- (insert_manual_invoice_payment / insert_credit_balance_payment) — a refund's
-- negative payment row is structurally identical to a manual reversal row
-- (provider left null), so every reversal-labelling display fix already
-- shipped (dashboard/Record/timeline, detected purely by amount < 0) picks it
-- up with zero further changes.
--
-- Same separation-of-duties model as manual payments: a request is applied
-- immediately when the requester is the school owner (nobody sits above them
-- to approve it); everyone else's request waits for a different holder of
-- approve-refunds. Two distinct terminal paths:
--   refund_method = 'bank_transfer'    -> ledger write happens synchronously
--                                         inside approve_refund_request (the
--                                         school already moved the money from
--                                         its own bank; this just records it).
--   refund_method = 'paystack_reversal' -> approve_refund_request only flips
--                                         the row to 'processing' and stamps
--                                         the approver; the actual Paystack
--                                         /refund API call happens in the
--                                         server action (synchronous HTTP call,
--                                         same convention as createDVA/
--                                         verifyTransaction — no background job
--                                         needed for a single API call), and
--                                         complete_refund_request /
--                                         fail_refund_request land the result
--                                         (Paystack can confirm synchronously
--                                         with `processed`, or asynchronously
--                                         via the refund.processed/refund.failed
--                                         webhook when it comes back `pending`).
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run).

-- ---------------------------------------------------------------------------
-- 1. refunds — new columns. Table/indexes/base RLS/FKs already exist
--    (fees101_schema.sql) and are reused as-is; the status CHECK already
--    covers every state this workflow needs (pending/approved/rejected/
--    processing/completed/failed) with no change required.
-- ---------------------------------------------------------------------------
alter table public.refunds
  add column if not exists requested_by_name text,
  add column if not exists approved_by_name text,
  -- The negative payments row created once this refund completes.
  add column if not exists reversal_payment_id uuid references public.payments(id),
  -- Paystack's own refund id, stamped as soon as the API call returns (even
  -- while still 'pending' on their side) so the later webhook can find this row.
  add column if not exists paystack_refund_id text,
  -- Distinct from rejection_reason: a Paystack-side failure, not a human decision.
  add column if not exists failure_reason text,
  add column if not exists auto_approved boolean not null default false,
  -- Denormalized from the original payment at request time — keeps the RPCs
  -- below simple (no join back through payments just to find the invoice).
  add column if not exists invoice_id uuid references public.invoices(id);

create index if not exists refunds_paystack_refund_id_idx
  on public.refunds (paystack_refund_id) where paystack_refund_id is not null;

-- At most one refund in flight (pending or processing) per payment at a time —
-- the concurrency gate against a double-refund race. A rejected or failed one
-- does not block a later retry.
create unique index if not exists refunds_one_active_per_payment
  on public.refunds (payment_id)
  where status in ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- 2. schools columns — console enables the feature per school; the owner
--    accepts the liability affirmation in-app. Exact same shape as
--    manual_payment_entry_enabled / manual_payment_liability_* on purpose.
-- ---------------------------------------------------------------------------
alter table public.schools
  add column if not exists refunds_enabled boolean not null default false,
  add column if not exists refunds_enabled_at timestamptz,
  add column if not exists refunds_enabled_by uuid,
  add column if not exists refunds_liability_version text,
  add column if not exists refunds_liability_accepted_at timestamptz,
  add column if not exists refunds_liability_accepted_by uuid references public.users(id);

-- ---------------------------------------------------------------------------
-- 3. RLS — drop the old role-name policies (predate the permission-catalog
--    system entirely) and replace with the has_permission()-based shape every
--    other feature in this app uses.
-- ---------------------------------------------------------------------------
drop policy if exists "Bursar can request refunds" on public.refunds;
drop policy if exists "School admin approves refunds" on public.refunds;
drop policy if exists "Super admin manages all refunds" on public.refunds;
drop policy if exists "Users see own school refunds" on public.refunds;

create policy "Read refunds in own school"
  on public.refunds for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

-- Same reasoning as manual_payment_entry.sql's insert policy: the feature must
-- actually be live for the school (console-enabled + owner liability accepted),
-- re-checked here so a permission holder cannot raise requests via a direct
-- PostgREST call while the feature is off.
create policy "Request-refunds inserts requests"
  on public.refunds for insert
  with check (
    (school_id = public.current_school_id()
      and (public.is_school_owner() or public.has_permission('request-refunds'))
      and exists (
        select 1 from public.schools s
        where s.id = school_id
          and s.refunds_enabled = true
          and s.refunds_liability_version is not null
          and s.refunds_liability_accepted_at is not null
      ))
    or public.is_super_admin()
  );

-- A direct client update may only reject a pending request, or stamp
-- paystack_refund_id on a row already 'processing' (the sync-API-call result
-- while waiting on Paystack's webhook). Every money-moving transition
-- (-> approved/completed/processing-via-approval, -> completed from
-- processing) goes through the SECURITY DEFINER RPCs below, which bypass RLS.
-- The guard trigger is the actual authority on which columns may change for
-- which transition; this policy only bounds which resulting status a direct
-- caller may ever land on.
create policy "Approve-refunds updates requests"
  on public.refunds for update
  using (
    (school_id = public.current_school_id()
      and (public.is_school_owner() or public.has_permission('approve-refunds')))
    or public.is_super_admin()
  )
  with check (
    (school_id = public.current_school_id()
      and (public.is_school_owner() or public.has_permission('approve-refunds'))
      and status in ('rejected', 'processing'))
    or public.is_super_admin()
  );

create policy "Super admin manages all refunds"
  on public.refunds for all
  using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 4. Guard trigger — money/identity columns are frozen once set, and only the
--    transitions this workflow actually uses are legal. Mirrors
--    manual_payment_requests_guard's shape.
-- ---------------------------------------------------------------------------
create or replace function public.refunds_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.amount is distinct from old.amount)
     or (new.student_id is distinct from old.student_id)
     or (new.payment_id is distinct from old.payment_id)
     or (new.invoice_id is distinct from old.invoice_id)
     or (new.requested_by is distinct from old.requested_by)
     or (new.refund_method is distinct from old.refund_method)
     or (new.category is distinct from old.category)
     or (new.reason is distinct from old.reason) then
    raise exception 'A refund request cannot be edited in place';
  end if;

  if old.status = 'pending' then
    if new.status not in ('rejected', 'processing', 'completed') then
      raise exception 'A refund request can only move from pending to rejected, processing or completed';
    end if;
  elsif old.status = 'processing' then
    if new.status not in ('processing', 'completed', 'failed') then
      raise exception 'A processing refund can only move to completed or failed';
    end if;
    -- Staying in 'processing' is only ever the sync-API-call stamping its
    -- paystack_refund_id while waiting on the webhook — nothing else may change.
    if new.status = 'processing' and (
      (new.approved_by is distinct from old.approved_by)
      or (new.approved_by_name is distinct from old.approved_by_name)
      or (new.approved_at is distinct from old.approved_at)
      or (new.auto_approved is distinct from old.auto_approved)
    ) then
      raise exception 'A processing refund request is otherwise immutable';
    end if;
  else
    raise exception 'A % refund request cannot be modified', old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists refunds_guard on public.refunds;
create trigger refunds_guard
  before update on public.refunds
  for each row execute function public.refunds_guard();

-- ---------------------------------------------------------------------------
-- 5. approve_refund_request — claims a pending request and either completes it
--    immediately (bank_transfer) or hands it to the caller to drive the
--    Paystack API call (paystack_reversal). Re-checks authorization, feature
--    liveness and separation-of-duties independently of the action layer,
--    same posture as approve_manual_payment_request.
-- ---------------------------------------------------------------------------
create or replace function public.approve_refund_request(
  p_refund_id uuid,
  p_school_id uuid,
  p_reviewer_id uuid,
  p_auto boolean default false
) returns table (
  refund_method text,
  status text,
  reversal_payment_id uuid,
  amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund refunds%rowtype;
  v_reviewer_name text;
  v_is_owner boolean;
  v_pay_amount numeric;
  v_pay_invoice uuid;
  v_pay_provider text;
  v_pay_student uuid;
  v_already_refunded numeric;
  v_method text;
  v_notes text;
  v_ledger_payment_id uuid;
begin
  if p_reviewer_id is distinct from auth.uid() then
    raise exception 'Reviewer does not match the signed-in user';
  end if;

  v_is_owner := public.is_school_owner();

  if not (
    (public.current_school_id() = p_school_id and (v_is_owner or public.has_permission('approve-refunds')))
    or public.is_super_admin()
  ) then
    raise exception 'Not authorized to approve refunds';
  end if;

  if not public.is_super_admin() then
    if not exists (
      select 1 from schools s
      where s.id = p_school_id
        and s.refunds_enabled = true
        and s.refunds_liability_version is not null
        and s.refunds_liability_accepted_at is not null
    ) then
      raise exception 'Refunds are not enabled for this school';
    end if;
  end if;

  select coalesce(name, 'Unknown user') into v_reviewer_name from users where id = auth.uid();

  -- Claim the row. Both methods claim into 'processing' first — uniform
  -- semantics, and the only transition the guard trigger needs to allow here.
  -- A second concurrent/retried approval finds zero rows below (status no
  -- longer 'pending') and raises before touching the ledger.
  update refunds
  set status = 'processing',
      auto_approved = p_auto,
      approved_by = p_reviewer_id,
      approved_by_name = v_reviewer_name,
      approved_at = now()
  where id = p_refund_id
    and school_id = p_school_id
    and status = 'pending'
  returning * into v_refund;

  if not found then
    raise exception 'This refund request has already been resolved or could not be found';
  end if;

  if not v_is_owner and v_refund.requested_by = p_reviewer_id then
    raise exception 'You cannot approve a refund you requested yourself';
  end if;

  -- paystack_reversal stops here — no ledger write until Paystack confirms.
  if v_refund.refund_method = 'paystack_reversal' then
    return query select v_refund.refund_method, v_refund.status, null::uuid, v_refund.amount;
    return;
  end if;

  -- bank_transfer: the school already moved the money from its own bank; this
  -- records it against the ledger synchronously, then moves processing ->
  -- completed in the same transaction (an already-legal transition, so the
  -- guard trigger needs no special case for this).
  select p.amount, p.invoice_id, p.provider, p.student_id
  into v_pay_amount, v_pay_invoice, v_pay_provider, v_pay_student
  from payments p
  where p.id = v_refund.payment_id and p.school_id = p_school_id
  for update;

  if v_pay_provider is null then
    raise exception 'Only automatically recorded payments can be refunded here; use a manual reversal for manually recorded payments';
  end if;

  select coalesce(sum(amount), 0) into v_already_refunded
  from refunds
  where payment_id = v_refund.payment_id
    and id <> v_refund.id
    and status in ('completed', 'processing');

  if v_already_refunded + v_refund.amount > v_pay_amount then
    raise exception 'Refund amount exceeds what remains refundable on this payment (already refunded %, original %)', v_already_refunded, v_pay_amount;
  end if;

  v_method := 'bank_transfer_manual';
  v_notes := 'Refund approved by ' || v_reviewer_name || coalesce(' — ref ' || v_refund.refund_reference, '');

  if v_pay_invoice is not null then
    v_ledger_payment_id := public.insert_manual_invoice_payment(
      v_pay_invoice, p_school_id, v_pay_student, -v_refund.amount, v_method, now(), v_notes, p_reviewer_id
    );
  else
    v_ledger_payment_id := public.insert_credit_balance_payment(
      p_school_id, v_pay_student, -v_refund.amount, v_method, null, null, null, now(), v_notes, null, p_reviewer_id
    );
  end if;

  update refunds
  set status = 'completed',
      reversal_payment_id = v_ledger_payment_id,
      processed_at = now()
  where id = p_refund_id;

  return query select v_refund.refund_method, 'completed'::text, v_ledger_payment_id, v_refund.amount;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. complete_refund_request — lands a paystack_reversal refund once Paystack
--    has actually confirmed it (either the synchronous API response already
--    said 'processed', or the refund.processed webhook did). Only acts on a
--    'processing' row.
-- ---------------------------------------------------------------------------
create or replace function public.complete_refund_request(
  p_refund_id uuid,
  p_paystack_refund_id text
) returns table (
  reversal_payment_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund refunds%rowtype;
  v_pay_amount numeric;
  v_pay_invoice uuid;
  v_pay_provider text;
  v_pay_student uuid;
  v_already_refunded numeric;
  v_notes text;
  v_ledger_payment_id uuid;
begin
  select * into v_refund from refunds where id = p_refund_id for update;
  if not found then
    raise exception 'Refund request not found';
  end if;
  if v_refund.status <> 'processing' then
    raise exception 'This refund is not awaiting completion';
  end if;

  select p.amount, p.invoice_id, p.provider, p.student_id
  into v_pay_amount, v_pay_invoice, v_pay_provider, v_pay_student
  from payments p
  where p.id = v_refund.payment_id and p.school_id = v_refund.school_id
  for update;

  if v_pay_provider is null then
    raise exception 'Only automatically recorded payments can be refunded here';
  end if;

  select coalesce(sum(amount), 0) into v_already_refunded
  from refunds
  where payment_id = v_refund.payment_id
    and id <> v_refund.id
    and status in ('completed', 'processing');

  if v_already_refunded + v_refund.amount > v_pay_amount then
    raise exception 'Refund amount exceeds what remains refundable on this payment';
  end if;

  v_notes := 'Refund processed via Paystack' || coalesce(' (ref ' || p_paystack_refund_id || ')', '');

  if v_pay_invoice is not null then
    v_ledger_payment_id := public.insert_manual_invoice_payment(
      v_pay_invoice, v_refund.school_id, v_pay_student, -v_refund.amount, 'other', now(), v_notes, v_refund.approved_by
    );
  else
    v_ledger_payment_id := public.insert_credit_balance_payment(
      v_refund.school_id, v_pay_student, -v_refund.amount, 'other', null, null, null, now(), v_notes, null, v_refund.approved_by
    );
  end if;

  update refunds
  set status = 'completed',
      processed_at = now(),
      reversal_payment_id = v_ledger_payment_id,
      paystack_refund_id = coalesce(paystack_refund_id, p_paystack_refund_id)
  where id = p_refund_id;

  return query select v_ledger_payment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. fail_refund_request — a paystack_reversal attempt that did not succeed
--    (API error, or the refund.failed webhook). No ledger changes. A fresh
--    request can be raised afterwards since the "one active" unique index
--    only blocks pending/processing rows.
-- ---------------------------------------------------------------------------
create or replace function public.fail_refund_request(
  p_refund_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update refunds
  set status = 'failed',
      failure_reason = p_reason
  where id = p_refund_id and status = 'processing';

  if not found then
    raise exception 'Refund request not found or not awaiting completion';
  end if;
end;
$$;
