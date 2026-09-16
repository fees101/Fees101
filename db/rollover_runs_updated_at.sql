-- Adds updated_at to rollover_runs so the year-end rollover cron sweep
-- (src/app/api/admin/rollover-sweep, mirroring db/background_jobs.sql's
-- job-sweep pattern) can tell a genuinely stalled run (killed mid-step by a
-- serverless timeout, or crashed) from one that's actively progressing.
-- rollover_runs was never given this column originally since nothing polled
-- it for staleness before now.
--
-- Reuses the existing public.set_updated_at() trigger function (already
-- wired up on billing_cycles/invoices/students/etc. in the base schema) so
-- every UPDATE to a row — every checkpoint write inside
-- continueYearEndRolloverCore — bumps updated_at automatically. No
-- application code needs to set it explicitly.
--
-- Run this once in the Supabase SQL editor.

alter table public.rollover_runs
  add column if not exists updated_at timestamptz;

update public.rollover_runs
  set updated_at = coalesce(completed_at, created_at)
  where updated_at is null;

alter table public.rollover_runs
  alter column updated_at set default now(),
  alter column updated_at set not null;

drop trigger if exists rollover_runs_updated_at on public.rollover_runs;
create trigger rollover_runs_updated_at
  before update on public.rollover_runs
  for each row execute function public.set_updated_at();

-- Sweep's own lookup: stalled runs are always status = 'in_progress'.
create index if not exists idx_rollover_runs_stale
  on public.rollover_runs (updated_at)
  where status = 'in_progress';
