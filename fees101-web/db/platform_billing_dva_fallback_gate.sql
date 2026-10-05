-- Owner-gated self-serve DVA (bank-transfer) fallback for platform billing.
--
-- The auto-debit mandate is the retention lock, so a school must not be able to
-- casually opt itself onto manual bank-transfer billing. This flag gates the
-- SELF-SERVE DVA choice on /connect-billing: a school can only pick "pay by bank
-- transfer instead" once a Fees101 owner has enabled it for that school (from the
-- console). Default false = hidden.
--
-- NOTE: this gates the self-serve CHOICE only. The reusable-card gate in
-- connect-billing/callback still auto-provisions a DVA when a card genuinely
-- cannot establish a mandate (non-reusable) and the bank isn't on the
-- direct-debit list — that's the legitimate "no mandate possible" safety net,
-- not a self-serve opt-out, so it is intentionally not gated here.
--
-- platform_billing has RLS enabled with no policies (service-role / server only),
-- same as the rest of the table — no policy needed. Run once in the Supabase SQL
-- editor. Idempotent.

alter table public.platform_billing
  add column if not exists dva_fallback_enabled boolean not null default false,
  add column if not exists dva_fallback_enabled_at timestamptz,
  -- A platform_admins id from the console app (cross-app, so no FK), matching the
  -- manual_payment_entry_enabled_by convention.
  add column if not exists dva_fallback_enabled_by uuid;

notify pgrst, 'reload schema';
