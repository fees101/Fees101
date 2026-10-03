-- Platform billing: periodic in-app nudge for DVA (manual bank transfer)
-- schools to connect automatic debit instead, decided 2026-10-03. Distinct
-- from the dunning ladder's payment-due/overdue reminders in dunning.ts and
-- dvaReminders.ts/mandateReminders.ts — those fire on a missed payment; this
-- one fires periodically regardless of payment status, since a DVA school can
-- be paying on time every month and still risk missing one later with no
-- automatic fallback in place.
--
-- Tracks when a school was last nudged so the cron can space reminders out
-- instead of firing on every run. Additive / if-not-exists so it's safe to
-- re-run.

alter table public.platform_billing
  add column if not exists dva_switch_reminded_at timestamptz;

notify pgrst, 'reload schema';
