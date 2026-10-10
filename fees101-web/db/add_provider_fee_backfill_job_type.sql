-- Adds 'provider_fee_backfill' as a valid background_jobs job_type — the
-- one-time historical cleanup that calls Paystack/Monnify's transaction-verify
-- API per old `payments` row that has a `provider` but no `provider_fee`
-- (rows created before db/payment_provider_fee.sql started being populated
-- live off the webhook's real `data.fees`). See
-- src/lib/payments/backfillProviderFees.ts and src/app/api/admin/
-- backfill-provider-fees/route.ts. Run this once in the Supabase SQL editor,
-- after db/background_jobs.sql and db/add_close_term_job_type.sql.

alter table public.background_jobs drop constraint background_jobs_job_type_check;

alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in ('invoice_generation', 'invoice_regeneration', 'csv_import', 'bulk_dva', 'bulk_send', 'close_term', 'provider_fee_backfill'));
