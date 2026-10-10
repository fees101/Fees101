-- Platform processing volume — the aggregator-pitch numbers (owner request,
-- 2026-10-10). Fees101 is exploring becoming its own payment aggregator/
-- facilitator with Paystack (and separately looked at this with Monnify)
-- instead of each school routing through them directly. Making that case
-- needs hard numbers on volume Fees101 already pushes through those
-- processors today — this gives fees101-console's Home page a real,
-- live-computed view instead of requiring a raw-table query every time the
-- conversation comes up.
--
-- SECURITY INVOKER, same convention as platform_business_overview.sql in
-- this same file: these run as whatever role calls them (the console's
-- service-role client), which already has unrestricted read access to
-- `payments` doing the equivalent query client-side — this is a faster,
-- properly-aggregated version of that, not a new privilege. Additive only:
-- new functions, no change to any existing table/column/RLS policy.
--
-- "Automatic processed payment" = payments.provider IS NOT NULL AND
-- payments.amount > 0. Confirmed against the app code (no `status` column on
-- `payments` — every row already represents money that actually landed;
-- `provider` is only ever 'paystack' | 'monnify' | NULL; every manual/cash/
-- POS entry and every refund/reversal row always carries provider = NULL —
-- see db/manual_payment_entry.sql and the db/refunds_*.sql family) so this
-- filter cleanly means "collected automatically via a processor," with no
-- manual-entry contamination and no reversal/refund rows (those are
-- amount <= 0 by construction, same reasoning platform_gross_payment_volume
-- above already uses). This deliberately reports GROSS processed volume —
-- what a processor's own aggregator conversation cares about — not
-- net-of-refunds; Fees101's own refund rate is a separate, internal number.
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run).
-- NOT YET RUN against live Supabase, per this repo's standing rule that new
-- SQL is additive-and-owner-run, not applied by an agent. Until it's run,
-- fees101-console's businessQueries.ts (getPlatformProcessingVolume) falls
-- back to an equivalent bounded in-app aggregation over a narrow column
-- selection — correct at today's data volume, same interim pattern already
-- used for platform_business_overview.sql's own functions.

-- All-time total + transaction count, by provider.
CREATE OR REPLACE FUNCTION public.platform_processing_volume_summary()
RETURNS TABLE (provider text, total_amount numeric, txn_count bigint, first_payment_at timestamptz, last_payment_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    provider,
    coalesce(sum(amount), 0),
    count(*),
    min(created_at),
    max(created_at)
  FROM public.payments
  WHERE provider IS NOT NULL AND amount > 0
  GROUP BY provider
  ORDER BY provider
$$;

-- Monthly trend by provider — the number that actually matters for an
-- aggregator pitch (growth trajectory, not a snapshot). Defaults to the
-- trailing 12 months.
CREATE OR REPLACE FUNCTION public.platform_processing_volume_by_month(p_months int DEFAULT 12)
RETURNS TABLE (provider text, month date, amount numeric, txn_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    provider,
    date_trunc('month', created_at)::date AS month,
    coalesce(sum(amount), 0),
    count(*)
  FROM public.payments
  WHERE provider IS NOT NULL
    AND amount > 0
    AND created_at >= date_trunc('month', now()) - (p_months || ' months')::interval
  GROUP BY provider, date_trunc('month', created_at)
  ORDER BY month, provider
$$;

-- Distinct schools actively processing this calendar month, by provider —
-- the "sub-merchant count" an aggregator conversation cares about alongside
-- raw volume.
CREATE OR REPLACE FUNCTION public.platform_processing_active_schools_this_month()
RETURNS TABLE (provider text, active_schools bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT provider, count(DISTINCT school_id)
  FROM public.payments
  WHERE provider IS NOT NULL
    AND amount > 0
    AND created_at >= date_trunc('month', now())
  GROUP BY provider
  ORDER BY provider
$$;
