-- Manual payment entry — school staff recording cash/POS/cheque payments that
-- never went through the automated Paystack/DVA pipeline.
--
-- The feature is turned on per school by Fees101 staff from the console app
-- (the manual_payment_entry_enabled columns below), and only becomes usable
-- for a school once that school's owner accepts the in-app liability
-- affirmation (the manual_payment_liability_* columns). Staff with the
-- record-manual-payments permission raise a request; it is applied to the
-- ledger either immediately (when the requester is the owner) or after a
-- holder of approve-manual-payments approves it. A mistake is never edited in
-- place — it is corrected with a second, negated request that references the
-- original via reversal_of, so the full history stays auditable.
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run).

-- ---------------------------------------------------------------------------
-- 1. manual_payment_requests — the request/approval/reversal record
-- ---------------------------------------------------------------------------
create table if not exists public.manual_payment_requests (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id),
  student_id         uuid not null references public.students(id),
  -- Null applies the money as a credit-balance top-up with no specific invoice.
  invoice_id         uuid references public.invoices(id),
  -- Positive for a payment; a reversal row carries the negated original amount.
  amount             numeric not null check (amount <> 0),
  method             text not null check (method in ('cash','pos','cheque','other')),
  deposited_to       text not null check (deposited_to in ('school_bank','paystack_dva','other')),
  deposit_reference  text,
  notes              text,
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid not null references public.users(id),
  requested_by_name  text not null,
  requested_at       timestamptz not null default now(),
  -- True when the requester IS the school owner: nobody sits above them to
  -- approve it, so it applies immediately, but it still flows through this
  -- table and the audit log exactly like any other request.
  auto_approved      boolean not null default false,
  reviewed_by        uuid references public.users(id),
  reviewed_by_name   text,
  reviewed_at        timestamptz,
  review_note        text,
  -- Set when this row corrects a previously approved row. The original is
  -- never mutated once its payment_id is set; a correction is always a new row
  -- pointing back at it here, carrying the negated amount.
  reversal_of        uuid references public.manual_payment_requests(id),
  -- Set once an approval actually writes the ledger row; null while pending or
  -- rejected.
  payment_id         uuid references public.payments(id),
  created_at         timestamptz not null default now()
);

create index if not exists manual_payment_requests_school_status_idx
  on public.manual_payment_requests (school_id, status, requested_at desc);
create index if not exists manual_payment_requests_reversal_of_idx
  on public.manual_payment_requests (reversal_of);

alter table public.manual_payment_requests enable row level security;

-- Same shape as the discounts/payments policies: school-scoped reads for
-- anyone in the school, writes gated on the matching permission (owner always
-- bypasses via is_school_owner()), super admins see and manage everything.
drop policy if exists "Read manual payment requests in own school" on public.manual_payment_requests;
create policy "Read manual payment requests in own school"
  on public.manual_payment_requests for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

-- An insert needs the permission AND the feature actually live for the school:
-- enabled by the console and the liability affirmation accepted by the owner.
-- Enforced here, not only in the server action, so a permission holder cannot
-- raise requests by calling PostgREST directly while the feature is off or the
-- liability was never accepted. (The exact accepted-version currency check stays
-- in the action, which knows the app's current version constant; the data layer
-- enforces the strictly stronger "enabled and some version accepted" gate.)
drop policy if exists "Record-manual-payments inserts requests" on public.manual_payment_requests;
create policy "Record-manual-payments inserts requests"
  on public.manual_payment_requests for insert
  with check (
    (school_id = public.current_school_id()
      and (public.is_school_owner() or public.has_permission('record-manual-payments'))
      and exists (
        select 1 from public.schools s
        where s.id = school_id
          and s.manual_payment_entry_enabled = true
          and s.manual_payment_liability_version is not null
          and s.manual_payment_liability_accepted_at is not null
      ))
    or public.is_super_admin()
  );

-- Routine approvals go through approve_manual_payment_request /
-- approve_manual_reversal_request (SECURITY DEFINER, so they bypass RLS and set
-- status='approved' + payment_id atomically). A DIRECT update from a session
-- token is therefore allowed to do only one thing: reject a still-pending
-- request. The WITH CHECK pins the resulting row to status='rejected'; the
-- BEFORE UPDATE trigger below pins the allowed source state to 'pending' and
-- freezes the money/identity columns. Net effect for any direct caller: no
-- in-place edit of a recorded payment, no flipping rejected back to approved,
-- no self-approval short-cut around the functions.
drop policy if exists "Approve-manual-payments updates requests" on public.manual_payment_requests;
create policy "Approve-manual-payments rejects requests"
  on public.manual_payment_requests for update
  using (
    (school_id = public.current_school_id()
      and (public.is_school_owner() or public.has_permission('approve-manual-payments')))
    or public.is_super_admin()
  )
  with check (
    (school_id = public.current_school_id()
      and (public.is_school_owner() or public.has_permission('approve-manual-payments'))
      and status = 'rejected')
    or public.is_super_admin()
  );

-- Immutability + strict status machine. Money and identity columns can never
-- change after insert, and the only legal status moves are pending -> approved
-- and pending -> rejected. The lone exception is stamping payment_id onto a row
-- the approval function has just set to 'approved' in the same transaction
-- (status stays 'approved'); direct callers can never reach that branch because
-- the RLS WITH CHECK above forces any direct update to land on 'rejected'.
create or replace function public.manual_payment_requests_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.amount is distinct from old.amount)
     or (new.student_id is distinct from old.student_id)
     or (new.invoice_id is distinct from old.invoice_id)
     or (new.requested_by is distinct from old.requested_by)
     or (new.reversal_of is distinct from old.reversal_of) then
    raise exception 'A recorded manual payment cannot be edited in place; correct it with a reversal instead';
  end if;

  if old.status = 'pending' then
    if new.status not in ('approved', 'rejected') then
      raise exception 'A manual payment request can only move from pending to approved or rejected';
    end if;
  elsif old.status = 'approved' and new.status = 'approved' then
    -- payment_id stamp from the approval function only; nothing else may change.
    if (new.reviewed_by is distinct from old.reviewed_by)
       or (new.reviewed_by_name is distinct from old.reviewed_by_name)
       or (new.reviewed_at is distinct from old.reviewed_at)
       or (new.auto_approved is distinct from old.auto_approved)
       or (new.review_note is distinct from old.review_note) then
      raise exception 'An approved manual payment is immutable';
    end if;
  else
    raise exception 'A % manual payment request cannot be modified', old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists manual_payment_requests_guard on public.manual_payment_requests;
create trigger manual_payment_requests_guard
  before update on public.manual_payment_requests
  for each row execute function public.manual_payment_requests_guard();

-- Only ONE active (pending or approved) reversal can ever exist per original,
-- even under concurrent approve/request. A rejected reversal is excluded, so a
-- fresh correction can still be raised after one was turned down.
create unique index if not exists manual_payment_requests_one_active_reversal
  on public.manual_payment_requests (reversal_of)
  where reversal_of is not null and status in ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- 2. schools columns — the console enables the feature; the owner accepts the
--    liability affirmation. These exact names are also read/written by
--    fees101-console; do not rename them.
-- ---------------------------------------------------------------------------
alter table public.schools
  add column if not exists manual_payment_entry_enabled boolean not null default false,
  add column if not exists manual_payment_entry_enabled_at timestamptz,
  -- A platform_admins id from the console app (cross-app, so no FK).
  add column if not exists manual_payment_entry_enabled_by uuid,
  add column if not exists manual_payment_liability_version text,
  add column if not exists manual_payment_liability_accepted_at timestamptz,
  add column if not exists manual_payment_liability_accepted_by uuid references public.users(id);

-- ---------------------------------------------------------------------------
-- 3. payments.recorded_by — the staff member a manual payment is attributed to.
--    The three RPCs below all insert it, and the shared provider path passes it
--    as null, so the column must exist before any of them is (re)created or a
--    clean deploy would fail. Idempotent.
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists recorded_by uuid references public.users(id);

-- ---------------------------------------------------------------------------
-- 4. Ledger functions — recreate the two existing payment-insert RPCs to carry
--    recorded_by (the staff member a manual payment is attributed to), keeping
--    every existing parameter and behaviour. The new parameter defaults to
--    null, so webhook callers that do not pass it are unaffected. Bodies are
--    otherwise identical to db/payment_provider_fee.sql.
-- ---------------------------------------------------------------------------
create or replace function public.apply_payment_to_invoice(
  p_invoice_id uuid,
  p_school_id uuid,
  p_student_id uuid,
  p_amount_available numeric,
  p_method text,
  p_provider text,
  p_provider_reference text,
  p_provider_transaction_id text,
  p_paid_at timestamptz,
  p_notes text,
  p_provider_fee numeric default null,
  p_recorded_by uuid default null
) returns table (
  payment_id uuid,
  amount_applied numeric,
  new_outstanding numeric,
  new_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_amount numeric;
  v_paid_amount numeric;
  v_outstanding numeric;
  v_apply_amount numeric;
  v_payment_id uuid;
  v_new_paid numeric;
  v_new_status text;
begin
  select total_amount, paid_amount into v_total_amount, v_paid_amount
  from invoices
  where id = p_invoice_id and school_id = p_school_id
  for update;

  if not found then
    raise exception 'Invoice % not found for school %', p_invoice_id, p_school_id;
  end if;

  v_outstanding := greatest(v_total_amount - v_paid_amount, 0);
  v_apply_amount := least(greatest(p_amount_available, 0), v_outstanding);

  if v_apply_amount <= 0 then
    return query select null::uuid, 0::numeric, v_outstanding, null::text;
    return;
  end if;

  insert into payments (
    school_id, student_id, invoice_id, amount, method, provider,
    provider_reference, provider_transaction_id, paid_at, match_status, notes,
    provider_fee, recorded_by
  ) values (
    p_school_id, p_student_id, p_invoice_id, v_apply_amount, p_method, p_provider,
    p_provider_reference, p_provider_transaction_id, p_paid_at, 'matched', p_notes,
    p_provider_fee, p_recorded_by
  )
  returning id into v_payment_id;

  select paid_amount, status into v_new_paid, v_new_status
  from invoices where id = p_invoice_id;

  return query select v_payment_id, v_apply_amount, greatest(v_total_amount - v_new_paid, 0), v_new_status;
end;
$$;

create or replace function public.insert_credit_balance_payment(
  p_school_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_method text,
  p_provider text,
  p_provider_reference text,
  p_provider_transaction_id text,
  p_paid_at timestamptz,
  p_notes text,
  p_provider_fee numeric default null,
  p_recorded_by uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  insert into payments (
    school_id, student_id, invoice_id, amount, method, provider,
    provider_reference, provider_transaction_id, paid_at, match_status, notes,
    provider_fee, recorded_by
  ) values (
    p_school_id, p_student_id, null, p_amount, p_method, p_provider,
    p_provider_reference, p_provider_transaction_id, p_paid_at, 'matched', p_notes,
    p_provider_fee, p_recorded_by
  )
  returning id into v_payment_id;

  perform adjust_student_credit_balance(
    p_student_id => p_student_id,
    p_school_id => p_school_id,
    p_delta => p_amount
  );

  return v_payment_id;
end;
$$;

-- Inserts an exact-amount payment row against a specific invoice WITHOUT the
-- outstanding-balance clamp apply_payment_to_invoice applies. This exists for
-- one job: reversing an approved manual payment, where the amount is negative
-- and must flow through to the invoice's paid_amount/status (the existing
-- payments-insert trigger handles that recalculation). The positive path still
-- uses apply_payment_to_invoice so a normal overpayment spills to credit.
create or replace function public.insert_manual_invoice_payment(
  p_invoice_id uuid,
  p_school_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_at timestamptz,
  p_notes text,
  p_recorded_by uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  insert into payments (
    school_id, student_id, invoice_id, amount, method, provider,
    provider_reference, provider_transaction_id, paid_at, match_status, notes,
    provider_fee, recorded_by
  ) values (
    p_school_id, p_student_id, p_invoice_id, p_amount, p_method, null,
    null, null, p_paid_at, 'matched', p_notes,
    null, p_recorded_by
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Approval RPCs — the single, atomic entry point for applying a manual entry
--    or a reversal to the ledger. Everything an approval does (claim the row,
--    write the payment(s), stamp payment_id) happens in ONE transaction, so:
--      * a second concurrent or retried approval matches zero pending rows on
--        the claim UPDATE and raises, instead of applying the money twice;
--      * a failure anywhere in the ledger rolls the whole thing back, so a
--        request is never left 'approved' with no payment, nor 'pending' with
--        money already moved.
--    SECURITY DEFINER so the function (not the caller's session) writes the
--    ledger and bypasses the deliberately narrow UPDATE RLS policy. The caller's
--    permission, school scope and identity are re-checked here against auth.uid()
--    so a direct PostgREST call cannot approve anything it should not.
-- ---------------------------------------------------------------------------
create or replace function public.approve_manual_payment_request(
  p_request_id uuid,
  p_school_id uuid,
  p_reviewer_id uuid,
  p_auto boolean default false
) returns table (
  payment_id uuid,
  invoice_amount numeric,
  new_outstanding numeric,
  is_full boolean,
  credit_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req manual_payment_requests%rowtype;
  v_reviewer_name text;
  v_is_owner boolean;
  v_amount numeric;
  v_notes text;
  v_apply record;
  v_credit_id uuid;
  v_remainder numeric;
  v_primary_payment_id uuid;
  v_invoice_amount numeric := 0;
  v_credit_amount numeric := 0;
  v_new_outstanding numeric := 0;
  v_is_full boolean := false;
begin
  -- Identity cannot be spoofed: the stamped reviewer must be the live caller.
  if p_reviewer_id is distinct from auth.uid() then
    raise exception 'Reviewer does not match the signed-in user';
  end if;

  v_is_owner := public.is_school_owner();

  -- Data-layer authorization, independent of the action layer.
  if not (
    (public.current_school_id() = p_school_id and (v_is_owner or public.has_permission('approve-manual-payments')))
    or public.is_super_admin()
  ) then
    raise exception 'Not authorized to approve manual payments';
  end if;

  -- Feature must be live (enabled + liability accepted). Super admin bypasses.
  if not public.is_super_admin() then
    if not exists (
      select 1 from schools s
      where s.id = p_school_id
        and s.manual_payment_entry_enabled = true
        and s.manual_payment_liability_version is not null
        and s.manual_payment_liability_accepted_at is not null
    ) then
      raise exception 'Manual payment entry is not enabled for this school';
    end if;
  end if;

  select coalesce(name, 'Unknown user') into v_reviewer_name from users where id = auth.uid();

  -- Claim the row. This conditional UPDATE is the concurrency gate: a second
  -- caller blocks on the row lock, then finds status no longer 'pending' and
  -- gets zero rows here, so it raises before touching the ledger.
  update manual_payment_requests
  set status = 'approved',
      auto_approved = p_auto,
      reviewed_by = p_reviewer_id,
      reviewed_by_name = v_reviewer_name,
      reviewed_at = now()
  where id = p_request_id
    and school_id = p_school_id
    and status = 'pending'
  returning * into v_req;

  if not found then
    raise exception 'This request has already been resolved or could not be found';
  end if;

  if v_req.reversal_of is not null then
    raise exception 'A reversal must be approved through approve_manual_reversal_request';
  end if;

  -- Separation of duties: you cannot approve an entry you recorded yourself,
  -- unless you are the school owner (the auto-approve path, and the only way a
  -- single-owner school can function).
  if not v_is_owner and v_req.requested_by = p_reviewer_id then
    raise exception 'You cannot approve a manual payment you recorded yourself';
  end if;

  -- Round to 2dp so the invoice/credit split never drifts on float math.
  v_amount := round(v_req.amount, 2);
  v_notes := 'Manual ' || v_req.method || ' entry recorded by ' || v_req.requested_by_name;
  if v_req.deposit_reference is not null then
    v_notes := v_notes || '; ref ' || v_req.deposit_reference;
  end if;

  if v_req.invoice_id is not null then
    select * into v_apply
    from public.apply_payment_to_invoice(
      v_req.invoice_id, p_school_id, v_req.student_id, v_amount, v_req.method,
      null, null, null, v_req.requested_at, v_notes, null, v_req.requested_by
    );
    v_invoice_amount := coalesce(v_apply.amount_applied, 0);
    v_new_outstanding := coalesce(v_apply.new_outstanding, 0);
    v_is_full := (v_apply.new_status = 'paid') or (v_new_outstanding <= 0);
    v_primary_payment_id := v_apply.payment_id;

    -- Overpayment beyond outstanding spills to the credit balance, matching the
    -- webhook waterfall.
    v_remainder := round(v_amount - v_invoice_amount, 2);
    if v_remainder > 0 then
      v_credit_id := public.insert_credit_balance_payment(
        p_school_id, v_req.student_id, v_remainder, v_req.method,
        null, null, null, v_req.requested_at,
        v_notes || '; overpayment applied to student credit balance', null, v_req.requested_by
      );
      v_credit_amount := v_remainder;
      if v_primary_payment_id is null then
        v_primary_payment_id := v_credit_id;
      end if;
    end if;
  else
    v_credit_id := public.insert_credit_balance_payment(
      p_school_id, v_req.student_id, v_amount, v_req.method,
      null, null, null, v_req.requested_at, v_notes, null, v_req.requested_by
    );
    v_credit_amount := v_amount;
    v_primary_payment_id := v_credit_id;
  end if;

  update manual_payment_requests
  set payment_id = v_primary_payment_id
  where id = p_request_id;

  return query select v_primary_payment_id, v_invoice_amount, v_new_outstanding, v_is_full, v_credit_amount;
end;
$$;

-- Approves a reversal. INVARIANT: corrections only ever act on manual entries
-- this feature recorded; a provider/DVA (automatically recorded) payment is
-- never editable or reversible here. The reversal row references the ORIGINAL
-- manual_payment_requests row via reversal_of, and the money is undone strictly
-- from that original request's own payment_id (which the approval RPC above
-- created through this feature). The original payment row is additionally
-- asserted to carry no provider, so no code path can feed an arbitrary
-- payments.id -- least of all a provider transaction -- into a reversal.
create or replace function public.approve_manual_reversal_request(
  p_request_id uuid,
  p_school_id uuid,
  p_reviewer_id uuid
) returns table (
  payment_id uuid,
  amount_reversed numeric,
  new_outstanding numeric,
  student_id uuid,
  invoice_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req manual_payment_requests%rowtype;
  v_orig manual_payment_requests%rowtype;
  v_reviewer_name text;
  v_is_owner boolean;
  v_original_amount numeric;
  v_pay_amount numeric;
  v_pay_invoice uuid;
  v_pay_provider text;
  v_invoice_portion numeric := 0;
  v_credit_portion numeric;
  v_rev_id uuid;
  v_primary_payment_id uuid;
  v_new_outstanding numeric;
begin
  if p_reviewer_id is distinct from auth.uid() then
    raise exception 'Reviewer does not match the signed-in user';
  end if;

  v_is_owner := public.is_school_owner();

  if not (
    (public.current_school_id() = p_school_id and (v_is_owner or public.has_permission('approve-manual-payments')))
    or public.is_super_admin()
  ) then
    raise exception 'Not authorized to approve manual payment reversals';
  end if;

  if not public.is_super_admin() then
    if not exists (
      select 1 from schools s
      where s.id = p_school_id
        and s.manual_payment_entry_enabled = true
        and s.manual_payment_liability_version is not null
        and s.manual_payment_liability_accepted_at is not null
    ) then
      raise exception 'Manual payment entry is not enabled for this school';
    end if;
  end if;

  select coalesce(name, 'Unknown user') into v_reviewer_name from users where id = auth.uid();

  -- Claim the reversal row (same concurrency gate as above).
  update manual_payment_requests
  set status = 'approved',
      auto_approved = false,
      reviewed_by = p_reviewer_id,
      reviewed_by_name = v_reviewer_name,
      reviewed_at = now()
  where id = p_request_id
    and school_id = p_school_id
    and status = 'pending'
    and reversal_of is not null
  returning * into v_req;

  if not found then
    raise exception 'This reversal has already been resolved or could not be found';
  end if;

  if not v_is_owner and v_req.requested_by = p_reviewer_id then
    raise exception 'You cannot approve a reversal you requested yourself';
  end if;

  -- The original must be a genuine, approved manual request of THIS school that
  -- actually wrote a payment. Anything else (missing, not approved, or no
  -- payment_id) is not reversible.
  select * into v_orig
  from manual_payment_requests
  where id = v_req.reversal_of and school_id = p_school_id;
  if not found then
    raise exception 'The original payment could not be found';
  end if;
  if v_orig.status <> 'approved' then
    raise exception 'The original payment is not in an approved state';
  end if;
  if v_orig.payment_id is null then
    raise exception 'The original payment has no recorded ledger entry to reverse';
  end if;

  v_original_amount := round(v_orig.amount, 2);

  -- Read the original payment row. It must be a manual entry this feature wrote
  -- (no provider) -- the structural guarantee that a provider/DVA payment can
  -- never be reversed through here.
  select amount, invoice_id, provider into v_pay_amount, v_pay_invoice, v_pay_provider
  from payments where id = v_orig.payment_id;
  if v_pay_provider is not null then
    raise exception 'Only manually recorded payments can be reversed';
  end if;
  if v_pay_invoice is not null then
    v_invoice_portion := round(coalesce(v_pay_amount, 0), 2);
  end if;
  v_credit_portion := round(greatest(v_original_amount - v_invoice_portion, 0), 2);

  -- Only the part that actually hit an invoice is reversed against it; the rest
  -- is reversed off the credit balance. Reversing credit already spent drives
  -- the balance negative on purpose -- that is the existing convention for a
  -- debt the student now owes, and a legitimate reversal must not be blocked.
  if v_invoice_portion > 0 and v_orig.invoice_id is not null then
    v_rev_id := public.insert_manual_invoice_payment(
      v_orig.invoice_id, p_school_id, v_orig.student_id, -v_invoice_portion,
      v_req.method, now(),
      'Reversal of manual payment (' || v_req.requested_by_name || ')', p_reviewer_id
    );
    v_primary_payment_id := v_rev_id;
    select outstanding_amount into v_new_outstanding from invoices where id = v_orig.invoice_id;
  end if;

  if v_credit_portion > 0 then
    v_rev_id := public.insert_credit_balance_payment(
      p_school_id, v_orig.student_id, -v_credit_portion, v_req.method,
      null, null, null, now(),
      'Reversal of manual payment credit (' || v_req.requested_by_name || ')', null, p_reviewer_id
    );
    if v_primary_payment_id is null then
      v_primary_payment_id := v_rev_id;
    end if;
  end if;

  update manual_payment_requests
  set payment_id = v_primary_payment_id
  where id = p_request_id;

  return query select v_primary_payment_id, v_original_amount, v_new_outstanding, v_orig.student_id, v_orig.invoice_id;
end;
$$;

notify pgrst, 'reload schema';
