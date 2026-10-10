-- Provider fee REVENUE aggregates — distinct from platform_processing_volume.sql
-- (gross ₦ volume Fees101 moves through Paystack/Monnify). This is how much
-- of that volume the PROCESSOR keeps as its own fee — the number that matters
-- for the aggregator pitch (owner, 2026-10-10 follow-up): "if ₦1,000,000 has
-- been transacted, the number that matters is how much Paystack kept as fee
-- (e.g. ₦30,000) — because that's the revenue Fees101 could capture/redirect
-- if it became the aggregator instead." Backs fees101-console's
-- /health/provider-fees page.
--
-- Fed by payments.provider_fee (db/payment_provider_fee.sql), populated from
-- the REAL per-transaction fee each provider's webhook/verify API reports
-- (Paystack's data.fees, Monnify's eventData.settlementAmount) — never a
-- guessed/hardcoded percentage, which would be wrong for DVA/transfer-
-- collected payments vs. card vs. USSD. Every NEW payment gets this live;
-- src/lib/payments/backfillProviderFees.ts (db/add_provider_fee_backfill_job_type.sql)
-- backfills older rows that predate that capture by calling the provider's own
-- verify API, so this is the single source of truth for both.
--
-- SECURITY INVOKER, same convention as platform_processing_volume.sql /
-- platform_business_overview.sql in this same spirit: runs as whatever role
-- calls it (the console's service-role client, which already has unrestricted
-- read access to `payments` doing the equivalent query client-side) — a
-- faster, properly-aggregated version of that, not a new privilege.
--
-- One real transaction can produce several `payments` rows (a transfer that
-- spans multiple invoices, or spills into credit_balance) — provider_fee is
-- only ever stamped on ONE of those rows per transaction (see
-- applyPayment.ts's nextProviderFee()), so summing it never double-counts,
-- and "transaction count" here means count(DISTINCT provider_reference), not
-- count(*) — a raw row count would overstate how many real transfers
-- happened. amount, by contrast, IS safe to sum across every row: each row
-- is a genuine split of one real transaction's total, not a repeat of it.
--
-- Run this once in the Supabase SQL editor, after db/payment_provider_fee.sql.
-- Idempotent (safe to re-run). NOT YET RUN against live Supabase, per this
-- repo's standing rule that new SQL is additive-and-owner-run, not applied by
-- an agent — until it's run, fees101-console's businessQueries.ts
-- (getProviderFeeRevenue) falls back to one bounded, narrow-column fetch and
-- aggregates in JS (correct at today's data volume: under 100 payment rows
-- across 4 schools), same interim pattern already used for
-- platform_processing_volume.sql. The moment this runs, the console switches
-- to the real SQL-level path with no code change needed.

-- All-time totals by provider: fee revenue, gross volume (for the effective-
-- rate sanity check), and both the "has fee data" and "total" transaction
-- counts so the console can show honest coverage ("N of M transactions have
-- fee data") instead of silently treating a missing fee as zero.
CREATE OR REPLACE FUNCTION public.platform_provider_fee_revenue_summary()
RETURNS TABLE (
  provider text,
  fee_revenue numeric,
  gross_volume numeric,
  txns_with_fee bigint,
  txns_total bigint,
  first_payment_at timestamptz,
  last_payment_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    provider,
    coalesce(sum(provider_fee), 0),
    coalesce(sum(amount), 0),
    count(DISTINCT provider_reference) FILTER (WHERE provider_fee IS NOT NULL),
    count(DISTINCT provider_reference),
    min(created_at),
    max(created_at)
  FROM public.payments
  WHERE provider IS NOT NULL AND amount > 0
  GROUP BY provider
  ORDER BY provider
$$;

-- Monthly trend by provider — the growth trajectory matters more than a
-- snapshot for an aggregator pitch. Defaults to the trailing 12 months.
-- Bucketed by created_at (when Fees101 recorded the payment), matching
-- platform_processing_volume_by_month's own bucketing so the two numbers
-- line up month-for-month when compared side by side.
CREATE OR REPLACE FUNCTION public.platform_provider_fee_revenue_by_month(p_months int DEFAULT 12)
RETURNS TABLE (provider text, month date, fee_revenue numeric, volume numeric, txn_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    provider,
    date_trunc('month', created_at)::date AS month,
    coalesce(sum(provider_fee), 0),
    coalesce(sum(amount), 0),
    count(DISTINCT provider_reference)
  FROM public.payments
  WHERE provider IS NOT NULL
    AND amount > 0
    AND created_at >= date_trunc('month', now()) - (p_months || ' months')::interval
  GROUP BY provider, date_trunc('month', created_at)
  ORDER BY month, provider
$$;

-- Per-school breakdown — which schools generate the most provider fee
-- revenue (also a plain "biggest accounts" signal, not just the aggregator
-- angle). Joins schools for the name since the console always wants it
-- alongside the id; RLS on both tables is school_id-scoped and irrelevant
-- here since this only ever runs via the service-role client.
CREATE OR REPLACE FUNCTION public.platform_provider_fee_revenue_by_school()
RETURNS TABLE (
  school_id uuid,
  school_name text,
  provider text,
  fee_revenue numeric,
  gross_volume numeric,
  txns_with_fee bigint,
  txns_total bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    p.school_id,
    s.name,
    p.provider,
    coalesce(sum(p.provider_fee), 0),
    coalesce(sum(p.amount), 0),
    count(DISTINCT p.provider_reference) FILTER (WHERE p.provider_fee IS NOT NULL),
    count(DISTINCT p.provider_reference)
  FROM public.payments p
  JOIN public.schools s ON s.id = p.school_id
  WHERE p.provider IS NOT NULL AND p.amount > 0
  GROUP BY p.school_id, s.name, p.provider
  ORDER BY sum(p.provider_fee) DESC NULLS LAST
$$;
