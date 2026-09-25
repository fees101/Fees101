-- Payment settings, extended for the redesigned /settings/payments ledger
-- (2026-09-17). The School > Payments mockup (m_school_payments_1440.png) shows
-- five rows the old monolithic form never stored:
--   Provider          "Monnify · live"            -> a live-vs-test mode flag
--   API keys          "Valid · verified today"    -> keys_verified_at
--                     "Rotated 14 March by you"   -> keys_rotated_at + keys_rotated_by
--   Settlement account "Wema Bank · ••••4021"      -> settlement_* columns
--   Reconciliation    "Automatic · last run 08:05" -> last_reconciled_at
-- (The fifth row, Accounts provisioned, already has its data via the student
--  provider_dva_* columns and needs no new store.)
--
-- Owner authorised this data-layer work on 2026-09-17 (it goes beyond the
-- read-only query rule for the redesign). All columns live on the existing
-- schools row (one settlement account per school, matching the single mockup
-- row) so they inherit the schools UPDATE RLS policy added in
-- db/schools_update_policy.sql — no new policy needed.
--
-- NOTE: the existing payment columns this builds beside
-- (payment_provider, provider_api_key, provider_secret_key,
--  provider_contract_code, students.provider_dva_account_number,
--  provider_dva_reference) were added directly in the Supabase SQL editor and
-- are not defined in any repo migration; see db/webhook_and_provider_tables.sql
-- for the same situation. This file is the first repo record of adjacent
-- payment columns.
--
-- Run this once in the Supabase SQL editor.

-- Live-vs-test mode. The provider keys alone don't reliably say which (only
-- Paystack keys carry a live/test prefix; Monnify's don't), so the school
-- states it explicitly. Defaults to 'test' so a half-configured school never
-- claims to be live.
alter table public.schools
  add column if not exists payment_mode text not null default 'test';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'schools_payment_mode_check'
  ) then
    alter table public.schools
      add constraint schools_payment_mode_check
      check (payment_mode in ('test', 'live'));
  end if;
end $$;

-- Provider key lifecycle. verified_at is stamped when a live "Test connection"
-- succeeds; rotated_at/by when a new key is actually saved (blank = keep old,
-- so a plain provider/mode edit does not count as a rotation).
alter table public.schools
  add column if not exists keys_verified_at timestamptz,
  add column if not exists keys_rotated_at timestamptz,
  add column if not exists keys_rotated_by uuid references public.users(id) on delete set null;

-- Settlement / payout account: where collected money lands. Account number is
-- stored plain (it is semi-public, already printed on invoices) and shown
-- masked in the UI.
alter table public.schools
  add column if not exists settlement_bank_name text,
  add column if not exists settlement_account_number text,
  add column if not exists settlement_account_name text;

-- Reconciliation last-run marker. Reconciliation is otherwise stateless
-- (reconcileSchool relies on processed_provider_transactions for idempotency);
-- this records when it last swept, for both the automatic cron and the new
-- manual "Run now" action, so the Payments ledger can show "last run HH:MM".
alter table public.schools
  add column if not exists last_reconciled_at timestamptz;
