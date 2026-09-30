-- Fixes the double-spend race found during 2026-09-16 stress-testing:
-- applyPayment.ts used to read an invoice's outstanding_amount, decide how
-- much of the incoming payment to apply, then insert the payment row as two
-- separate steps with no lock in between. Two concurrent webhook deliveries
-- for the same invoice (two distinct, legitimately-signed references) could
-- both read the same stale outstanding_amount and both apply their full
-- amount, producing paid_amount > total_amount with the overage routed
-- nowhere (not credited, not flagged).
--
-- This function makes the decision atomic: it locks the invoice row before
-- computing how much is actually still owed, inserts the payment for at
-- most that amount, then re-reads the row (still holding the lock) so the
-- caller knows exactly how much was applied and can route any leftover to
-- credit_balance instead of letting a second concurrent call over-apply.
-- Run once in the Supabase SQL editor. Assumes paid_amount/status/
-- outstanding_amount on invoices are kept in sync by the existing
-- payments-insert trigger (not tracked in this repo — see fees101_schema
-- notes elsewhere in ROADMAP.md); this function does not duplicate that
-- logic, it just serializes access to it per invoice.
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
  p_notes text
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
    provider_reference, provider_transaction_id, paid_at, match_status, notes
  ) values (
    p_school_id, p_student_id, p_invoice_id, v_apply_amount, p_method, p_provider,
    p_provider_reference, p_provider_transaction_id, p_paid_at, 'matched', p_notes
  )
  returning id into v_payment_id;

  select paid_amount, status into v_new_paid, v_new_status
  from invoices where id = p_invoice_id;

  return query select v_payment_id, v_apply_amount, greatest(v_total_amount - v_new_paid, 0), v_new_status;
end;
$$;
