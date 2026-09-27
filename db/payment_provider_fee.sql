-- Adds real per-transaction provider-fee tracking, the data prerequisite for
-- the "fee buffer" dashboard visualization (ROADMAP.md, 2026-09-27 entry).
-- Run this once in the Supabase SQL editor.

-- provider_fee: what Paystack/Monnify actually deducted on this transaction,
-- in naira. Only ever set on the FIRST payment row created from a given
-- incoming transaction — a transfer that spans multiple invoices (or spills
-- into credit_balance) produces several `payments` rows from one real
-- transfer, and attributing the fee once avoids double-counting it when the
-- dashboard sums this column per term. Null for manual/cash entries (no
-- provider fee exists) and for anything recorded before this column existed.
alter table public.payments
  add column if not exists provider_fee numeric(12,2);

-- Both payment-insert paths get an optional fee param, defaulted to null so
-- every existing caller (manual entry, anything not yet passing it) is
-- unaffected.
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
  p_provider_fee numeric default null
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
    provider_fee
  ) values (
    p_school_id, p_student_id, p_invoice_id, v_apply_amount, p_method, p_provider,
    p_provider_reference, p_provider_transaction_id, p_paid_at, 'matched', p_notes,
    p_provider_fee
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
  p_provider_fee numeric default null
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
    provider_fee
  ) values (
    p_school_id, p_student_id, null, p_amount, p_method, p_provider,
    p_provider_reference, p_provider_transaction_id, p_paid_at, 'matched', p_notes,
    p_provider_fee
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
