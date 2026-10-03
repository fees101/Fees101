-- Platform billing: bank-transfer (DVA) fallback for schools whose bank isn't
-- on Paystack's direct-debit-enabled list, decided 2026-10-03. A school
-- connects via EITHER a direct-debit mandate (billing_method='mandate',
-- automatic) OR a Fees101-owned dedicated virtual account it transfers into
-- each month (billing_method='dva', manual) — same pricing/accrual engine,
-- just a different collection rail. A school can switch between the two later
-- (e.g. their bank gains direct-debit support, or a failing mandate needs a
-- manual fallback).
--
-- platform_dva_reference/account_number/bank_name/bank_code/created_at already
-- exist from db/platform_billing_model.sql (the original DVA-only design) and
-- are reused here rather than duplicated.
--
-- Additive / if-not-exists so it's safe to re-run. Service-role only (RLS on,
-- no policies), same as the rest of platform_billing.

alter table public.platform_billing
  add column if not exists billing_method text not null default 'mandate'
    check (billing_method in ('mandate', 'dva')),
  -- When an owner (or the account-closure job) deactivates the direct-debit
  -- mandate. Kept distinct from mandate_status so "why can't this school be
  -- charged" is answerable without inferring it from a status enum change.
  add column if not exists mandate_deactivated_at timestamptz;

notify pgrst, 'reload schema';
