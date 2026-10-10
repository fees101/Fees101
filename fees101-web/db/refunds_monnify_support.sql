-- Extends the refunds workflow (db/refunds_workflow.sql, db/refunds_self_serve.sql,
-- db/refunds_external_reconciliation.sql) to a Monnify-connected school.
-- Until now 'paystack_reversal' was the only automatic-refund method the
-- schema/RPCs knew about — a Monnify school had no automatic option at all,
-- only 'bank_transfer'. This adds 'monnify_reversal', handled identically to
-- 'paystack_reversal' everywhere: approve_refund_request stops at
-- 'processing' and leaves the actual provider API call to the server action
-- (src/app/(app)/money/refunds/actions.ts, now generic over both reversal
-- methods), which then calls complete_refund_request/fail_refund_request the
-- same way for either provider. The existing paystack_refund_id column is
-- reused to hold Monnify's refund reference too (same convention
-- externalMoneyLoss.ts already documents for the external-detection case) —
-- no new column, no rename, to keep every existing index/RPC signature intact.
--
-- Run this once in the Supabase SQL editor, after db/refunds_external_reconciliation.sql.
-- Idempotent (safe to re-run).

alter table public.refunds drop constraint if exists refunds_refund_method_check;
alter table public.refunds add constraint refunds_refund_method_check
  check (refund_method in (
    'paystack_reversal', 'monnify_reversal', 'bank_transfer', 'cash', 'credit_to_balance', 'other', 'chargeback'
  ));

-- approve_refund_request: the only change is the method check below —
-- 'monnify_reversal' now takes the same "stop at processing, let the caller
-- drive the provider API call" path 'paystack_reversal' already took.
-- Everything else is byte-for-byte the version from db/refunds_self_serve.sql.
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

  -- Both automatic methods stop here — no ledger write until the provider
  -- (Paystack or Monnify) confirms, same reasoning either way.
  if v_refund.refund_method in ('paystack_reversal', 'monnify_reversal') then
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

-- complete_refund_request: identical to db/refunds_workflow.sql's version
-- except the ledger note names the actual provider instead of hardcoding
-- "Paystack" (the only automatic method that existed when this was written).
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
  v_provider_label text;
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

  v_provider_label := case when v_refund.refund_method = 'monnify_reversal' then 'Monnify' else 'Paystack' end;
  v_notes := 'Refund processed via ' || v_provider_label || coalesce(' (ref ' || p_paystack_refund_id || ')', '');

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

-- confirm_external_refund: identical to db/refunds_external_reconciliation.sql's
-- version except the ledger note names the actual provider the money left
-- from (Monnify or Paystack) instead of hardcoding "Paystack".
create or replace function public.confirm_external_refund(
  p_refund_id uuid,
  p_school_id uuid,
  p_reviewer_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund refunds%rowtype;
  v_reviewer_name text;
  v_pay_invoice uuid;
  v_pay_student uuid;
  v_pay_amount numeric;
  v_already_refunded numeric;
  v_method text;
  v_notes text;
  v_provider_label text;
  v_ledger_payment_id uuid;
begin
  if p_reviewer_id is distinct from auth.uid() then
    raise exception 'Reviewer does not match the signed-in user';
  end if;

  if not (
    (public.current_school_id() = p_school_id and (public.is_school_owner() or public.has_permission('approve-refunds')))
    or public.is_super_admin()
  ) then
    raise exception 'Not authorized to confirm refunds';
  end if;

  select coalesce(name, 'Unknown user') into v_reviewer_name from users where id = auth.uid();

  update refunds
  set status = 'processing',
      approved_by = p_reviewer_id,
      approved_by_name = v_reviewer_name,
      approved_at = now()
  where id = p_refund_id
    and school_id = p_school_id
    and status = 'pending'
    and initiated_externally = true
  returning * into v_refund;

  if not found then
    raise exception 'This item has already been resolved or could not be found';
  end if;

  select amount into v_pay_amount from payments where id = v_refund.payment_id and school_id = p_school_id for update;

  select coalesce(sum(amount), 0) into v_already_refunded
  from refunds
  where payment_id = v_refund.payment_id
    and id <> v_refund.id
    and status in ('completed', 'processing');

  if v_already_refunded + v_refund.amount > v_pay_amount then
    raise exception 'Confirming this would refund more than the original payment (already accounted for %, original %)', v_already_refunded, v_pay_amount;
  end if;

  select p.invoice_id, p.student_id into v_pay_invoice, v_pay_student
  from payments p
  where p.id = v_refund.payment_id and p.school_id = p_school_id
  for update;

  v_method := 'bank_transfer_manual';
  v_provider_label := case when v_refund.refund_method = 'monnify_reversal' then 'Monnify' else 'Paystack' end;
  v_notes := 'Confirmed by ' || v_reviewer_name || ' — ' ||
    case when v_refund.refund_method = 'chargeback' then 'chargeback' else 'refund' end ||
    ' happened directly on ' || v_provider_label || ', outside Fees101.';

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
end;
$$;
