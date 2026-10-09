-- Refund analytics for the Money -> Collections dashboard (2026-10-09).
-- Discounts already get their own metric tile and "given by category" table
-- there (analytics_discount_series) — Refunds had the same real financial
-- impact (money leaving after it was already counted as collected) with no
-- visibility at all. This adds the same treatment: per term + category +
-- method, how much was actually refunded.
--
-- Only COMPLETED refunds count — a pending/processing/rejected/failed request
-- never moved real money, same reasoning analytics_discount_series only counts
-- 'approved'/'applied' discounts, not every request ever filed. Attributed to
-- the ORIGINAL invoice's term (refunds.invoice_id, denormalized at request
-- time — see db/refunds_workflow.sql), matching how a refund's negative
-- payment row already lands back on that same invoice: a refund of a payment
-- from a closed term shows up against that closed term, not whichever term is
-- open today. A refund with no invoice_id (it came out of unapplied credit
-- balance, never a real invoice) is excluded — there's no term to attribute it
-- to, the same reasoning credit_ledger.sql uses for its own null-origin rows.
--
-- Run this once in the Supabase SQL editor, after db/refunds_workflow.sql.
-- Idempotent (safe to re-run).
CREATE OR REPLACE FUNCTION public.analytics_refund_series(p_school_id uuid)
RETURNS TABLE (
  cycle_id uuid,
  category text,
  refund_method text,
  refund_count bigint,
  refunded_amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    i.billing_cycle_id,
    r.category,
    r.refund_method,
    count(*),
    coalesce(sum(r.amount), 0)
  FROM public.refunds r
  JOIN public.invoices i ON i.id = r.invoice_id
  WHERE r.school_id = p_school_id
    AND r.status = 'completed'
  GROUP BY i.billing_cycle_id, r.category, r.refund_method;
$$;

GRANT EXECUTE ON FUNCTION public.analytics_refund_series(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
