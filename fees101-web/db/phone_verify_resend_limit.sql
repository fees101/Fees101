-- =====================================================================
-- Cap phone-verification code sends per number: at most 3 sends within
-- any rolling 24-hour window, so a school whose number can't actually
-- receive SMS (e.g. no carrier coverage) can't burn unlimited credit
-- clicking "Resend". The existing 60s cooldown already spaces out rapid
-- clicks; this adds the hard ceiling on top of it.
--
-- Run this once in the Supabase SQL editor.
-- =====================================================================

alter table public.schools
  add column if not exists phone_verify_send_count integer not null default 0,
  add column if not exists phone_verify_window_started_at timestamptz;
