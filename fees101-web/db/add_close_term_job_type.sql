-- Adds 'close_term' (post-close carry-forward invoice recompute) as a valid
-- background_jobs job_type. Run this once in the Supabase SQL editor, after
-- db/background_jobs.sql and db/add_bulk_send_job_type.sql.

alter table public.background_jobs drop constraint background_jobs_job_type_check;

alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in ('invoice_generation', 'invoice_regeneration', 'csv_import', 'bulk_dva', 'bulk_send', 'close_term'));
