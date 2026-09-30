-- Two functions, `apply_invoice_recompute` and `insert_generated_invoice`,
-- that each atomically write an invoice AND adjust the student's
-- credit_balance in one transaction. Run this once in the Supabase SQL
-- editor. Requires `adjust_student_credit_balance` to already exist (it's
-- called from inside both functions below) — that function isn't tracked
-- in this repo's SQL files; find its current definition in the Supabase
-- dashboard (Database > Functions) if it ever needs to be restored.
--
-- Why this exists: closeTermCarryForward.ts and invoiceGeneration.ts's
-- generation/regeneration chunks all recompute or insert an invoice as
-- multiple separate network calls — undo old credit / insert or update the
-- invoice row / apply new credit. Those job types are resumable (a
-- mid-chunk crash leaves the job 'running' and a sweep replays the same
-- chunk), so a crash landing between any of those calls left the DB in a
-- half-done state that a naive retry couldn't distinguish from "not started
-- yet" — silently over- or under-crediting a student's balance on every
-- such crash.
--
-- Fix: callers no longer touch students.credit_balance directly around the
-- recompute. They read the student's live credit_balance once, pass
-- (liveBalance + thisInvoice.credit_applied) into computeInvoiceForStudent
-- as creditBalanceOverride (a param that already existed for exactly this
-- purpose — see computeInvoice.ts) to see what the invoice would look like
-- with its own previously-applied credit given back, then call this
-- function ONCE with the invoice's new field values and the single NET
-- credit delta (previouslyApplied - newCreditApplied). Both writes commit
-- or neither does, so a replayed chunk starts from a consistent state no
-- matter where a prior attempt was killed.
create or replace function public.apply_invoice_recompute(
  p_invoice_id uuid,
  p_school_id uuid,
  p_student_id uuid,
  p_line_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_reason text,
  p_previous_balance numeric,
  p_previous_balance_from_invoice_id uuid,
  p_credit_applied numeric,
  p_total_amount numeric,
  p_status text,
  p_needs_resend boolean,
  p_credit_delta numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update invoices
  set
    line_items = p_line_items,
    subtotal = p_subtotal,
    discount_amount = coalesce(p_discount_amount, discount_amount),
    discount_reason = coalesce(p_discount_reason, discount_reason),
    previous_balance = p_previous_balance,
    previous_balance_from_invoice_id = p_previous_balance_from_invoice_id,
    credit_applied = p_credit_applied,
    total_amount = p_total_amount,
    status = p_status,
    needs_resend = p_needs_resend,
    updated_at = now()
  where id = p_invoice_id and school_id = p_school_id;

  if not found then
    raise exception 'Invoice % not found for school %', p_invoice_id, p_school_id;
  end if;

  if p_credit_delta <> 0 then
    -- Reuses the existing atomic credit-balance adjuster (whatever its
    -- current logic is) so this function doesn't need to duplicate it —
    -- it just needs the invoice write and the credit write to land in the
    -- same transaction, which a plain function call already guarantees.
    perform adjust_student_credit_balance(
      p_student_id => p_student_id,
      p_school_id => p_school_id,
      p_delta => p_credit_delta
    );
  end if;
end;
$$;

-- Same reasoning, for brand-new invoices (invoice_generation job): a crash
-- between INSERT succeeding and the credit spend that invoice recorded would
-- leave that credit permanently unspent from the balance — and because
-- (student_id, billing_cycle_id) is unique, a naive retry's re-insert for
-- that student just fails as a duplicate and never gets a chance to apply
-- the missed credit spend. One transaction for both.
create or replace function public.insert_generated_invoice(
  p_school_id uuid,
  p_student_id uuid,
  p_billing_cycle_id uuid,
  p_invoice_number text,
  p_line_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_reason text,
  p_previous_balance numeric,
  p_previous_balance_from_invoice_id uuid,
  p_credit_applied numeric,
  p_total_amount numeric,
  p_status text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
begin
  insert into invoices (
    school_id, student_id, billing_cycle_id, invoice_number,
    line_items, subtotal, discount_amount, discount_reason,
    previous_balance, previous_balance_from_invoice_id,
    credit_applied, total_amount, paid_amount, status,
    sent_at, needs_resend, generated_at
  ) values (
    p_school_id, p_student_id, p_billing_cycle_id, p_invoice_number,
    p_line_items, p_subtotal, p_discount_amount, p_discount_reason,
    p_previous_balance, p_previous_balance_from_invoice_id,
    p_credit_applied, p_total_amount, 0, p_status,
    null, false, now()
  )
  returning id into v_invoice_id;

  if p_credit_applied <> 0 then
    perform adjust_student_credit_balance(
      p_student_id => p_student_id,
      p_school_id => p_school_id,
      p_delta => -p_credit_applied
    );
  end if;

  return v_invoice_id;
end;
$$;

-- Same reasoning, for a payment overpayment spilling into credit_balance
-- (applyPayment.ts). The webhook processor claims the provider transaction
-- (processed_provider_transactions) before this ever runs, so this isn't
-- auto-retried the way the job-based fixes above are — but a crash between
-- inserting the credit-balance payment row and actually crediting the
-- balance would still leave real money recorded as received with nothing to
-- show for it on the student's account, and nothing would ever revisit it.
create or replace function public.insert_credit_balance_payment(
  p_school_id uuid,
  p_student_id uuid,
  p_amount numeric,
  p_method text,
  p_provider text,
  p_provider_reference text,
  p_provider_transaction_id text,
  p_paid_at timestamptz,
  p_notes text
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
    provider_reference, provider_transaction_id, paid_at, match_status, notes
  ) values (
    p_school_id, p_student_id, null, p_amount, p_method, p_provider,
    p_provider_reference, p_provider_transaction_id, p_paid_at, 'matched', p_notes
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
