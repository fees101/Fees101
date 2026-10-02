-- Platform billing: direct-debit mandate + one-time setup fee (decided
-- 2026-10-01). Supersedes the v2 "school transfers into a Fees101-owned DVA"
-- COLLECTION mechanism (db/platform_billing_model.sql) with an AUTOMATIC pull:
-- the school authorizes a Paystack Direct Debit mandate once, and from then on
-- dues are debited from their bank with no manual transfer and no reminders.
-- The pricing engine (price_per_student_month, daily accrual, periods) is
-- unchanged and reused; only how money is collected changes.
--
-- Flow this supports:
--   1. Owner sets password, lands on /connect-billing.
--   2. Accepts billing terms (clickwrap) + pays a one-time, NONREFUNDABLE setup
--      fee via Paystack's `bank` channel with custom_filters.recurring=true.
--      That single payment both proves billing works AND creates the reusable
--      mandate (authorization_code).
--   3. Setup fee succeeding unlocks the app (the entry gate keys off
--      setup_fee_paid_at, which is instant — not the mandate going "active",
--      which Paystack takes ~3h to do and which only matters 65+ days later
--      before the first recurring debit).
--
-- Additive / if-not-exists so it's safe to re-run. Service-role only (RLS on,
-- no policies), same as the rest of the platform_billing tables.

alter table public.platform_billing
  -- One-time setup fee (nonrefundable). Amount stored so a change of price
  -- doesn't rewrite history; status/reference/paid_at track the single charge.
  add column if not exists setup_fee_amount numeric not null default 10000,
  add column if not exists setup_fee_status text not null default 'unpaid'
    check (setup_fee_status in ('unpaid', 'pending', 'paid', 'failed')),
  add column if not exists setup_fee_reference text,
  add column if not exists setup_fee_paid_at timestamptz,

  -- The direct-debit mandate. authorization_code is the permanent handle used
  -- for every future debit (transaction/charge_authorization). It must be
  -- charged with the matching email, so that's stored alongside. Status tracks
  -- the Paystack lifecycle: pending (authorized, ~3h from chargeable) ->
  -- active (chargeable) ; failed/revoked are terminal.
  add column if not exists mandate_authorization_code text,
  add column if not exists mandate_email text,
  add column if not exists mandate_status text not null default 'none'
    check (mandate_status in ('none', 'pending', 'active', 'failed', 'revoked')),
  add column if not exists mandate_authorized_at timestamptz,  -- consent captured
  add column if not exists mandate_active_at timestamptz,      -- chargeable

  -- Clickwrap record: who accepted which version of the billing terms, when.
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_accepted_by uuid references public.users(id) on delete set null,
  add column if not exists terms_version text,

  -- The entry gate flag. Set when the setup fee is paid; null means the school
  -- cannot enter the app yet. Separate from onboarding_at (the free-period
  -- day-0 anchor) even though both are set at the same moment, so the gate
  -- stays readable independently of the accrual engine.
  add column if not exists billing_connected_at timestamptz;

-- Grandfather every school already in the table: they predate this gate and
-- must not be locked out. Only schools onboarded AFTER this migration (which
-- get a fresh row, or none, with a null billing_connected_at) will hit the
-- /connect-billing gate.
update public.platform_billing
  set billing_connected_at = now()
  where billing_connected_at is null;

notify pgrst, 'reload schema';
