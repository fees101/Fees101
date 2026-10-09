-- Reconciling money that left via Paystack WITHOUT going through Fees101 at
-- all — a staff member refunding a transaction directly from Paystack's own
-- dashboard, or a cardholder successfully disputing/charging back a payment.
-- Paystack fires the exact same webhooks either way (refund.processed,
-- charge.dispute.resolve); the gap was entirely on our side — the existing
-- refund.processed handler only ever looked for a `refunds` row WE created,
-- and there was no handler at all for disputes. Found + scoped 2026-10-09
-- after the owner asked "did we handle what happens if they refund from the
-- Paystack app directly."
--
-- Deliberately NOT auto-reconciling the ledger from the webhook alone — only
-- DETECT, record, and flag a human. The actual invoice/credit adjustment only
-- ever happens when a staff member clicks "Confirm" in the Refunds workspace
-- (confirm_external_refund below), so a wrong proration or a misidentified
-- transaction never silently corrupts the books unattended.
--
-- Run this once in the Supabase SQL editor, after db/refunds_self_serve.sql.
-- Idempotent (safe to re-run).

alter table public.refunds
  add column if not exists initiated_externally boolean not null default false;

-- A chargeback is the same shape of event as a refund for our purposes (money
-- left the school's Paystack balance without an app-side request), just a
-- different real-world cause — tracked as its own refund_method so the
-- Refunds workspace can label it correctly instead of calling it a refund.
alter table public.refunds drop constraint if exists refunds_refund_method_check;
alter table public.refunds add constraint refunds_refund_method_check
  check (refund_method in ('paystack_reversal', 'bank_transfer', 'cash', 'credit_to_balance', 'other', 'chargeback'));

-- Confirms a row the webhook detected (initiated_externally = true, still
-- 'pending') actually happened, and only THEN writes the ledger adjustment —
-- same invoice/credit-split logic approve_refund_request's bank_transfer
-- branch already uses, since by the time this runs we already know exactly
-- which payment/invoice it's against (resolved at detection time, not here).
-- No self-approval check (there's no requester to collide with) and no
-- liability-acceptance check (this isn't a new refund being requested, it's
-- acknowledging one that already happened on Paystack's side regardless of
-- what Fees101 thinks).
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
  v_method text;
  v_notes text;
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

  select p.invoice_id, p.student_id into v_pay_invoice, v_pay_student
  from payments p
  where p.id = v_refund.payment_id and p.school_id = p_school_id
  for update;

  v_method := 'bank_transfer_manual';
  v_notes := 'Confirmed by ' || v_reviewer_name || ' — ' ||
    case when v_refund.refund_method = 'chargeback' then 'chargeback' else 'refund' end ||
    ' happened directly on Paystack, outside Fees101.';

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
