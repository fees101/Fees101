-- Manual credit reallocation between siblings (ROADMAP.md, Phase — manual
-- credit reallocation, 2026-09-27). A family DVA payment attributes any
-- overflow past every open invoice to a single deterministic student
-- (applyPayment.ts's lastTouchedStudentId fallback) — reasonable most of the
-- time, but occasionally wrong (e.g. the family intended it for a different
-- child). Nothing today lets staff move that credit_balance to the right
-- sibling without a manual database edit. This is a same-family-only
-- balance-to-balance transfer: no invoice, no payment record — just the
-- unapplied credit sitting on one student moving to another.
--
-- Run this in the Supabase SQL editor (not auto-applied). Depends on
-- adjust_student_credit_balance, which already exists live but isn't in a
-- tracked migration file (see db/add_atomic_invoice_credit_functions.sql's
-- header comment) — this function calls it the same way
-- applyCreditBalanceDelta (src/lib/computeInvoice.ts) already does from the
-- app, so it only works if that function is already present.
create or replace function public.transfer_family_credit_balance(
  p_school_id uuid,
  p_from_student_id uuid,
  p_to_student_id uuid,
  p_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_family uuid;
  v_to_family uuid;
  v_from_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Transfer amount must be positive';
  end if;

  if p_from_student_id = p_to_student_id then
    raise exception 'Cannot transfer credit to the same student';
  end if;

  -- Row-locked so a concurrent transfer or payment touching either
  -- student's balance can't read a stale amount mid-transaction.
  select family_id, credit_balance into v_from_family, v_from_balance
    from students
    where id = p_from_student_id and school_id = p_school_id
    for update;

  if v_from_family is null then
    raise exception 'Source student not found in this school';
  end if;

  select family_id into v_to_family
    from students
    where id = p_to_student_id and school_id = p_school_id
    for update;

  if v_to_family is null then
    raise exception 'Destination student not found in this school';
  end if;

  if v_from_family is distinct from v_to_family then
    raise exception 'Both students must belong to the same family';
  end if;

  if v_from_balance < p_amount then
    raise exception 'Amount exceeds the source student''s available credit balance';
  end if;

  perform adjust_student_credit_balance(
    p_student_id => p_from_student_id,
    p_school_id => p_school_id,
    p_delta => -p_amount
  );
  perform adjust_student_credit_balance(
    p_student_id => p_to_student_id,
    p_school_id => p_school_id,
    p_delta => p_amount
  );
end;
$$;
