-- Lets a user dismiss the "this job didn't finish" notice for a job whose
-- owning browser tab/session is gone (see the "Surface incomplete/failed
-- background jobs on login" roadmap item). Without this, a failed/interrupted
-- job surfaced on layout load would either re-show every page load forever or
-- need to be deleted to go away.
--
-- Run this once in the Supabase SQL editor.

alter table public.background_jobs
  add column if not exists acknowledged_at timestamptz;
