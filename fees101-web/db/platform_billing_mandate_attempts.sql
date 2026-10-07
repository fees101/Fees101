-- Smart, reason-aware bank-transfer (DVA) fallback for platform billing connect.
--
-- The auto-debit mandate stays the gated, pushed path (db/platform_billing_dva_
-- fallback_gate.sql): a school can't casually opt onto manual transfer, so people
-- can't take 65 free days + easy transfer and never actually commit. What we add
-- here is the SYSTEM smart-enabling transfer on its own when the mandate genuinely
-- won't work, so a stuck owner isn't trapped and no Fees101 staffer is strictly
-- required (they can still enable it manually from the console, and are the
-- hand-holding path for the first schools):
--
--   * A HARD failure (bank doesn't support direct debit, or the checkout was
--     abandoned) opens transfer immediately.
--   * A TRANSIENT failure (declined, insufficient funds, timeout) is counted; once
--     it crosses MANDATE_SOFT_FAIL_THRESHOLD (code side), transfer opens.
--
-- These columns back that logic. Additive / if-not-exists, service-role only (RLS
-- on, no policies), same as the rest of platform_billing. Run once. Idempotent.

alter table public.platform_billing
  -- How many times the owner has kicked off the mandate setup checkout
  -- (startBillingConnection). Incremented per attempt; read by the callback and
  -- the connect screen to decide when the transfer fallback auto-opens.
  add column if not exists mandate_attempt_count integer not null default 0,
  -- The gateway_response / status of the most recent failed attempt, so the
  -- connect screen can tell the owner what actually went wrong.
  add column if not exists mandate_last_failure_reason text,
  -- When that most recent attempt was made (telemetry + support context).
  add column if not exists mandate_last_attempt_at timestamptz;

notify pgrst, 'reload schema';
