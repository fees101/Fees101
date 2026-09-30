-- Shared background-job tracker. Replaces "client loops over batches in React
-- state" for heavy per-student work (invoice generation/regeneration, CSV
-- import, bulk DVA creation) with a persisted row a worker route advances and
-- the client polls — so a closed tab or serverless timeout can't silently
-- lose progress. See src/lib/jobs/backgroundJobs.ts and
-- src/app/api/jobs/process/route.ts.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.background_jobs (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  job_type     text not null check (job_type in ('invoice_generation', 'invoice_regeneration', 'csv_import', 'bulk_dva')),
  status       text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  payload      jsonb not null default '{}'::jsonb,   -- immutable job input, e.g. { "cycleId": "..." }
  cursor       jsonb not null default '{}'::jsonb,   -- resume point, meaning is job_type-specific
  total        integer not null default 0,
  processed    integer not null default 0,
  failed       integer not null default 0,
  failures     jsonb not null default '[]'::jsonb,   -- [{ label, error }], persisted so a refresh doesn't lose them
  error        text,                                  -- set when status = 'failed'
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists background_jobs_school_status_idx
  on public.background_jobs (school_id, status, updated_at desc);

-- Safety-net cron sweep: find running jobs stalled for a while, across all schools.
create index if not exists background_jobs_running_updated_idx
  on public.background_jobs (updated_at) where status = 'running';

alter table public.background_jobs enable row level security;

-- Staff read their own school's jobs (so the client can poll one it started
-- or find an already-running one on page load). All writes go through the
-- worker route's service-role client — no direct client insert/update, so
-- there's no need for a permission-specific INSERT/UPDATE policy here.
create policy "Users see own school background jobs"
  on public.background_jobs for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

create policy "Super admin manages all background jobs"
  on public.background_jobs
  using (public.is_super_admin());
