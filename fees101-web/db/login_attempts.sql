-- Per-account login throttling (2026-09-16 stress test: 15 rapid wrong-
-- password attempts against a known account all returned identical fast
-- responses with no throttling, delay, or lockout).
--
-- Keyed by email, not IP: login happens before there's a session, and a
-- shared front-desk computer / school network sitting behind one NAT IP is
-- the common case here, not the exception — an IP-based lock would risk
-- locking out a whole staff room over one person's typos. Throttling the
-- account itself is what actually stops credential stuffing against a
-- known email, which is exactly what the finding demonstrated.
--
-- Only ever touched via createServiceRoleClient() (see src/app/login/actions.ts),
-- since the check has to run before there's an authenticated session to
-- scope RLS by — so RLS is enabled with zero policies, same pattern as the
-- pre-auth tables in webhook_and_provider_tables.sql.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.login_attempts (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  success     boolean not null,
  created_at  timestamptz not null default now()
);

create index if not exists login_attempts_email_created_idx
  on public.login_attempts (lower(email), created_at desc);

-- Prune old rows lazily rather than running a cron for such a low-volume
-- table — see clearOldLoginAttempts() in src/app/login/actions.ts, called
-- opportunistically on a small random fraction of login attempts.

alter table public.login_attempts enable row level security;
