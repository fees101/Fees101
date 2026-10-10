-- Cross-tenant, read-only aggregates backing fees101-console's new Business
-- overview (2026-10-10) — the owner's own income/projection/tax-visibility
-- dashboard, so they don't need Paystack's dashboard, a spreadsheet, or
-- accounting software to see Fees101's own business health. Additive only:
-- new functions, no change to any existing table, column, or RLS policy.
--
-- SECURITY INVOKER (not DEFINER), same convention as analytics_refund_series.sql
-- etc: these run as whatever role calls them. The console calls them via its
-- service-role client, which already bypasses RLS at the Postgres role level
-- (same access it already has doing the equivalent query client-side) — this
-- is just a faster, properly-aggregated version of that, not a new privilege.
-- If a normal authenticated user ever called these directly, each underlying
-- table's existing RLS policy (payments/students/families/schools are all
-- school_id-scoped) would silently limit them to their own school's rows —
-- no escalation path.
--
-- Run this once in the Supabase SQL editor. Idempotent (safe to re-run).

-- Gross payment volume moving through the whole platform (what PARENTS pay
-- schools, not Fees101's own cut) — useful business context distinct from
-- Fees101's own revenue below. A reversal/refund row has amount <= 0 by
-- construction (see db/payments_allow_reversal_amount.sql) so `amount > 0`
-- already excludes those without needing a separate flag.
CREATE OR REPLACE FUNCTION public.platform_gross_payment_volume(p_since timestamptz DEFAULT NULL)
RETURNS TABLE (total_amount numeric, payment_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT coalesce(sum(amount), 0), count(*)
  FROM public.payments
  WHERE amount > 0
    AND (p_since IS NULL OR created_at >= p_since)
$$;

-- Fees101's OWN revenue by month — actual cash collected from schools for
-- using the platform (setup fees + recurring mandate/DVA charges), cash
-- basis: only status='success' rows, keyed off paid_at (when the money
-- actually moved), not created_at (when the attempt was made). This is the
-- real top-line number for a revenue/MRR view — see platform_billing_charges
-- (db/platform_dashboard_schema.sql, db/platform_billing_model.sql).
CREATE OR REPLACE FUNCTION public.platform_revenue_by_month(p_months int DEFAULT 12)
RETURNS TABLE (month date, amount numeric, charge_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT date_trunc('month', paid_at)::date AS month, coalesce(sum(amount), 0), count(*)
  FROM public.platform_billing_charges
  WHERE status = 'success'
    AND paid_at >= date_trunc('month', now()) - (p_months || ' months')::interval
  GROUP BY 1
  ORDER BY 1
$$;

-- Fees101's own revenue, broken down by what it actually was (one-time setup
-- fee vs recurring monthly platform fee) — `charged_by` already distinguishes
-- these at write time (see platform_billing_charges sample data: 'setup_fee'
-- / 'monthly_fee'), this just aggregates it for the dashboard.
CREATE OR REPLACE FUNCTION public.platform_revenue_by_kind(p_since timestamptz DEFAULT NULL)
RETURNS TABLE (charged_by text, total_amount numeric, charge_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT coalesce(charged_by, 'unknown'), coalesce(sum(amount), 0), count(*)
  FROM public.platform_billing_charges
  WHERE status = 'success'
    AND (p_since IS NULL OR paid_at >= p_since)
  GROUP BY 1
  ORDER BY 2 DESC
$$;

-- Platform-wide headcount/tenant stats for the "how is the business doing"
-- view — total/active/suspended schools, total active students, total
-- families, payment-provider split. One round trip instead of N client-side
-- queries.
CREATE OR REPLACE FUNCTION public.platform_wide_counts()
RETURNS TABLE (
  total_schools bigint,
  active_billing_schools bigint,
  suspended_schools bigint,
  total_active_students bigint,
  total_families bigint,
  paystack_schools bigint,
  monnify_schools bigint,
  unconfigured_schools bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    (SELECT count(*) FROM public.schools),
    (SELECT count(*) FROM public.platform_billing WHERE billing_status = 'active'),
    (SELECT count(*) FROM public.platform_billing WHERE billing_status = 'suspended'),
    (SELECT count(*) FROM public.students WHERE status = 'active'),
    (SELECT count(*) FROM public.families),
    (SELECT count(*) FROM public.schools WHERE payment_provider = 'paystack'),
    (SELECT count(*) FROM public.schools WHERE payment_provider = 'monnify'),
    (SELECT count(*) FROM public.schools WHERE payment_provider IS NULL)
$$;
