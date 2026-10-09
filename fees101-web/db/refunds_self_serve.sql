-- Refunds, made self-serve (2026-10-09) — follow-up to db/refunds_workflow.sql.
--
-- Decision: unlike manual payment entry, refunds should not need Fees101 staff
-- to flip a per-school switch before a school can use them — at scale that
-- turns a legitimate need (a withdrawing student, a parent who doesn't want
-- credit left on file) into a support ticket to Fees101 every time. The real
-- protection was never the console toggle; it's the school OWNER's acceptance
-- of the responsibility note (refunds_liability_version/accepted_at/by on
-- schools, unchanged). This migration removes every refunds_enabled check —
-- the owner's acceptance is now the only gate — and leaves the
-- refunds_enabled/refunds_enabled_at/refunds_enabled_by columns in place but
-- unused (harmless, same "no urgency to drop" posture already applied
-- elsewhere in this schema), in case a per-school kill-switch is ever wanted
-- again later.
--
-- Run this once in the Supabase SQL editor, after refunds_workflow.sql.
-- Idempotent (safe to re-run).

update public.schools set refunds_enabled = true where refunds_enabled = false;
alter table public.schools alter column refunds_enabled set default true;

drop policy if exists "Request-refunds inserts requests" on public.refunds;
create policy "Request-refunds inserts requests"
  on public.refunds for insert
  with check (
    (school_id = public.current_school_id()
      and (public.is_school_owner() or public.has_permission('request-refunds'))
      and exists (
        select 1 from public.schools s
        where s.id = school_id
          and s.refunds_liability_version is not null
          and s.refunds_liability_accepted_at is not null
      ))
    or public.is_super_admin()
  );

-- Missing from refunds_workflow.sql, found live: the owner's auto-approve
-- attempt (requestRefund) deletes its own just-inserted row if approval fails
-- (e.g. the approve_refund_request bug this file also fixes), so a failed
-- attempt doesn't linger as a phantom pending request. With no DELETE policy
-- at all, that cleanup silently failed under RLS and the row stayed visible.
-- Scoped tightly to the exact cleanup case: only ever a still-'pending' row,
-- only the requester, so it can't be used to erase a real decided refund.
drop policy if exists "Requester deletes their own still-pending refund" on public.refunds;
create policy "Requester deletes their own still-pending refund"
  on public.refunds for delete
  using (
    (school_id = public.current_school_id() and requested_by = auth.uid() and status = 'pending')
    or public.is_super_admin()
  );

-- Postgres won't let CREATE OR REPLACE change a function's OUT-parameter row
-- type (here: renaming status -> result_status) — it has to be dropped first.
drop function if exists public.approve_refund_request(uuid, uuid, uuid, boolean);

create or replace function public.approve_refund_request(
  p_refund_id uuid,
  p_school_id uuid,
  p_reviewer_id uuid,
  p_auto boolean default false
) returns table (
  refund_method text,
  result_status text,
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
        and s.refunds_liability_version is not null
        and s.refunds_liability_accepted_at is not null
    ) then
      raise exception 'The school owner has not yet accepted the refunds responsibility note';
    end if;
  end if;

  select coalesce(name, 'Unknown user') into v_reviewer_name from users where id = auth.uid();

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

  if v_refund.refund_method = 'paystack_reversal' then
    return query select v_refund.refund_method, v_refund.status, null::uuid, v_refund.amount;
    return;
  end if;

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

-- Found live 2026-10-09: requesting a 'paystack_reversal' refund failed with
-- "violates check constraint refunds_refund_method_check" — the live
-- constraint's allowed set doesn't match what fees101_schema.sql's dump shows
-- (that dump is stale here, same caveat already noted elsewhere for this
-- table). 'bank_transfer' is confirmed already allowed (a real row exists);
-- recreate the constraint with the full intended set so both app-facing
-- methods work, plus the original dump's other values for safety.
alter table public.refunds drop constraint if exists refunds_refund_method_check;
alter table public.refunds add constraint refunds_refund_method_check
  check (refund_method in ('paystack_reversal', 'bank_transfer', 'cash', 'credit_to_balance', 'other'));
