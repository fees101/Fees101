-- Targeted fix for the manual-payment REVERSAL approval.
--
-- Two problems this corrects, without re-running the whole manual_payment_entry.sql:
--   1. approve_manual_reversal_request raised "column reference invoice_id is
--      ambiguous" — the bare `invoice_id` in its read of the payments row
--      collided with the function's own RETURNS TABLE OUT column `invoice_id`.
--      Fixed by qualifying the payments columns (p.amount / p.invoice_id /
--      p.provider).
--   2. It (re)creates the function with CREATE OR REPLACE and reloads the
--      PostgREST schema cache, so the earlier "could not find the function ...
--      in the schema cache" is cleared too.
--
-- This is the exact same function body as in db/manual_payment_entry.sql (now
-- also corrected there). Run once in the Supabase SQL editor. Idempotent.

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

  -- Qualified with the table alias: this function's RETURNS TABLE declares an OUT
  -- column `invoice_id`, so a bare `invoice_id` here would be ambiguous.
  select p.amount, p.invoice_id, p.provider into v_pay_amount, v_pay_invoice, v_pay_provider
  from payments p where p.id = v_orig.payment_id;
  if v_pay_provider is not null then
    raise exception 'Only manually recorded payments can be reversed';
  end if;
  if v_pay_invoice is not null then
    v_invoice_portion := round(coalesce(v_pay_amount, 0), 2);
  end if;
  v_credit_portion := round(greatest(v_original_amount - v_invoice_portion, 0), 2);

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
