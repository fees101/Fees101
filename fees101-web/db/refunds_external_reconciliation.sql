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
  v_pay_amount numeric;
  v_already_refunded numeric;
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

  -- Over-refund guard: more than one externally-detected item can now exist
  -- on the same payment at once (see the relaxed unique index below — two
  -- genuinely separate Paystack-side events, e.g. two partial refunds before
  -- either was reviewed, each get their own row instead of the second one
  -- failing to record at all). This is the check that keeps confirming both
  -- from ever crediting back more than the payment actually covers.
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

-- Found 2026-10-10 live-testing the external-detection path: the original
-- "one active refund per payment" unique index (db/refunds_workflow.sql)
-- blocks ANY second pending/processing row on the same payment — a rule
-- meant to stop a staff member double-SUBMITTING a request. An
-- externally-detected row isn't a request at all (nobody asked, the money
-- already moved on Paystack's side regardless of what Fees101 thinks), so if
-- the same transaction gets refunded more than once before the first
-- detected item is confirmed or dismissed, the second detection would fail
-- to insert — not silently (the error-checking added earlier today makes it
-- throw and Paystack redeliver), but it would never record as its own item
-- until the first is cleared. Scoping the constraint to only
-- initiated_externally = false lets genuinely separate Paystack-side events
-- each get their own row; confirm_external_refund's over-refund guard above
-- is what now stops the total ever exceeding what the original payment
-- actually covers, which is the real protection this index was for anyway.
drop index if exists refunds_one_active_per_payment;
create unique index if not exists refunds_one_active_per_payment
  on public.refunds (payment_id)
  where status in ('pending', 'processing') and initiated_externally = false;
