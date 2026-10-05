-- Fix a function-overload ambiguity that broke ALL provider payments
-- (DVA + terminal) after db/manual_payment_entry.sql was applied.
--
-- payment_provider_fee.sql created 11-arg apply_payment_to_invoice /
-- 10-arg insert_credit_balance_payment. manual_payment_entry.sql then created
-- 12-/11-arg overloads (adding p_recorded_by). Postgres keeps BOTH, because the
-- argument lists differ. A call that supplies only the original args now matches
-- both candidates (the extra arg has a default), so Postgres raises
-- "could not choose the best candidate function" and the payment never applies —
-- the webhook returns 200 but the money is silently dropped.
--
-- Fix: drop the superseded shorter overloads so only the current
-- p_recorded_by-bearing versions remain. Those accept the old call shape too
-- (the extra arg defaults to null), so every existing caller keeps working.
--
-- Run once in the Supabase SQL editor. Idempotent (drop if exists).

drop function if exists public.apply_payment_to_invoice(
  uuid, uuid, uuid, numeric, text, text, text, text, timestamptz, text, numeric
);

drop function if exists public.insert_credit_balance_payment(
  uuid, uuid, numeric, text, text, text, text, timestamptz, text, numeric
);

notify pgrst, 'reload schema';
