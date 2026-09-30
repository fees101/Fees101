-- =====================================================================
-- Analytics aggregation functions (DB-side, for the /payments page)
-- =====================================================================
-- Why these exist: the analytics page needs lifetime + per-session + per-term
-- figures. Pulling every invoice (each with a line_items JSON blob) into the
-- app and looping in JS would get slow as history grows. These functions do
-- the GROUP BY inside Postgres and return small, ready-made result sets.
--
-- Design: every function returns ONE ROW PER CYCLE (a "series"). The app then
-- aggregates those small per-cycle rows for whatever scope the user picks —
-- lifetime (all cycles), a session (the cycles in it), or a single term. This
-- keeps the DB calls to a fixed 4 no matter what the user selects.
--
-- Security: SECURITY INVOKER (default) so table RLS still applies, AND every
-- function filters by p_school_id explicitly — so it stays correctly scoped
-- even while RLS is being rebuilt.
--
-- Run this whole file in the Supabase SQL editor. Safe to re-run (CREATE OR
-- REPLACE). No data is modified.
-- =====================================================================

-- 1) One row per billing cycle (term), across all history, with its session.
--    Powers the trend line charts, the lifetime/session/term totals, and the
--    summary tiles. gross_potential = what could have been billed before any
--    discount was applied (billed is net of discount and credit).
CREATE OR REPLACE FUNCTION public.analytics_term_series(p_school_id uuid)
RETURNS TABLE (
  cycle_id uuid,
  cycle_name text,
  start_date date,
  session_id uuid,
  session_name text,
  status text,
  invoice_count bigint,
  billed numeric,
  collected numeric,
  outstanding numeric,
  discount_total numeric,
  gross_potential numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    bc.id,
    bc.name,
    bc.start_date,
    bc.session_id,
    s.name,
    bc.status,
    count(i.id),
    coalesce(sum(i.total_amount + coalesce(i.credit_applied, 0)), 0),
    coalesce(sum(i.paid_amount + coalesce(i.credit_applied, 0)), 0),
    coalesce(sum(i.outstanding_amount), 0),
    coalesce(sum(i.discount_amount), 0),
    coalesce(sum(i.total_amount + coalesce(i.credit_applied, 0) + i.discount_amount), 0)
  FROM public.billing_cycles bc
  LEFT JOIN public.sessions s ON s.id = bc.session_id
  LEFT JOIN public.invoices i
    ON i.billing_cycle_id = bc.id AND i.status <> 'cancelled'
  WHERE bc.school_id = p_school_id
  GROUP BY bc.id, bc.name, bc.start_date, bc.session_id, s.name, bc.status
  ORDER BY bc.start_date;
$$;

-- 2) Revenue by fee, per term. Unnests each invoice's line_items and keeps
--    only fee lines (required + opt_in). collected_est allocates money by how
--    far each invoice is settled (money is fungible across an invoice's lines,
--    so a per-line figure is a proportional estimate).
CREATE OR REPLACE FUNCTION public.analytics_fee_series(p_school_id uuid)
RETURNS TABLE (
  cycle_id uuid,
  cycle_name text,
  start_date date,
  fee_name text,
  kind text,
  students_billed bigint,
  billed numeric,
  collected_est numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    bc.id,
    bc.name,
    bc.start_date,
    li->>'name',
    li->>'kind',
    count(*),
    coalesce(sum((li->>'amount')::numeric), 0),
    coalesce(sum(
      (li->>'amount')::numeric *
      CASE
        WHEN i.outstanding_amount <= 0 THEN 1::numeric
        WHEN i.total_amount <= 0 THEN 0::numeric
        ELSE least(1::numeric, i.paid_amount / i.total_amount)
      END
    ), 0)
  FROM public.invoices i
  JOIN public.billing_cycles bc ON bc.id = i.billing_cycle_id
  CROSS JOIN LATERAL jsonb_array_elements(i.line_items) li
  WHERE i.school_id = p_school_id
    AND i.status <> 'cancelled'
    AND (li->>'kind') IN ('required', 'opt_in')
  GROUP BY bc.id, bc.name, bc.start_date, li->>'name', li->>'kind'
  ORDER BY bc.start_date;
$$;

-- 3) Discount money cut, per term + category. Uses the invoice's real
--    discount_amount (the accurate naira figure) split equally across the
--    active discounts on that invoice — exact when an invoice has one discount,
--    an estimate when it has several. Returned per cycle so the app can scope
--    it to a term, a session, or lifetime by summing.
CREATE OR REPLACE FUNCTION public.analytics_discount_series(p_school_id uuid)
RETURNS TABLE (
  cycle_id uuid,
  category text,
  discount_count bigint,
  student_count bigint,
  est_amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH active_disc AS (
    SELECT
      d.id, d.category, d.student_id, d.invoice_id,
      count(*) OVER (PARTITION BY d.invoice_id) AS disc_on_invoice
    FROM public.discounts d
    WHERE d.school_id = p_school_id
      AND d.status IN ('approved', 'applied')
  )
  SELECT
    i.billing_cycle_id,
    ad.category,
    count(*),
    count(DISTINCT ad.student_id),
    coalesce(sum(i.discount_amount / nullif(ad.disc_on_invoice, 0)), 0)
  FROM active_disc ad
  JOIN public.invoices i
    ON i.id = ad.invoice_id AND i.status <> 'cancelled'
  GROUP BY i.billing_cycle_id, ad.category;
$$;

-- 4) Collection by class, per term. Returned per cycle so the app can scope to
--    a term/session/lifetime. (Lifetime "by class" aggregates the same class
--    name across terms — a student who was promoted contributes to each class
--    they passed through, which is the intended reading.)
CREATE OR REPLACE FUNCTION public.analytics_class_series(p_school_id uuid)
RETURNS TABLE (
  cycle_id uuid,
  class_name text,
  students_billed bigint,
  billed numeric,
  collected numeric,
  outstanding numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    i.billing_cycle_id,
    coalesce(c.name, 'Unassigned'),
    count(i.id),
    coalesce(sum(i.total_amount + coalesce(i.credit_applied, 0)), 0),
    coalesce(sum(i.paid_amount + coalesce(i.credit_applied, 0)), 0),
    coalesce(sum(i.outstanding_amount), 0)
  FROM public.invoices i
  JOIN public.students st ON st.id = i.student_id
  LEFT JOIN public.classes c ON c.id = st.class_id
  WHERE i.school_id = p_school_id
    AND i.status <> 'cancelled'
  GROUP BY i.billing_cycle_id, c.name;
$$;

-- 5) Monthly collection within a single term. Uses actual payment dates so the
--    term-scope view can show how money came in month by month (billing is
--    upfront, so only "collected" is meaningful at month granularity).
CREATE OR REPLACE FUNCTION public.analytics_month_series(
  p_school_id uuid,
  p_cycle_id uuid
)
RETURNS TABLE (
  month date,
  collected numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    date_trunc('month', p.paid_at)::date,
    coalesce(sum(p.amount), 0)
  FROM public.payments p
  JOIN public.invoices i ON i.id = p.invoice_id
  WHERE p.school_id = p_school_id
    AND i.billing_cycle_id = p_cycle_id
    AND i.status <> 'cancelled'
  GROUP BY 1
  ORDER BY 1;
$$;

-- 6) Fee price by class, per term. Powers the "fee price over time" chart:
--    pick a fee and see each class's price as its own line across terms (so you
--    can watch tuition rise year on year, and see how it varies per class).
--    price = avg sticker amount for that fee in that class that term (the
--    line-item amount is the fee's price BEFORE any discount, and is uniform
--    within a class — avg just collapses the per-student rows). A school-wide
--    fee (one price for everyone) yields the same price for every class, so its
--    lines overlap into one; a per-class fee fans out.
CREATE OR REPLACE FUNCTION public.analytics_fee_class_series(p_school_id uuid)
RETURNS TABLE (
  cycle_id uuid,
  cycle_name text,
  start_date date,
  fee_name text,
  kind text,
  class_name text,
  students_billed bigint,
  billed numeric,
  price numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    bc.id,
    bc.name,
    bc.start_date,
    li->>'name',
    li->>'kind',
    coalesce(c.name, 'Unassigned'),
    count(*),
    coalesce(sum((li->>'amount')::numeric), 0),
    coalesce(round(avg((li->>'amount')::numeric)), 0)
  FROM public.invoices i
  JOIN public.billing_cycles bc ON bc.id = i.billing_cycle_id
  JOIN public.students st ON st.id = i.student_id
  LEFT JOIN public.classes c ON c.id = st.class_id
  CROSS JOIN LATERAL jsonb_array_elements(i.line_items) li
  WHERE i.school_id = p_school_id
    AND i.status <> 'cancelled'
    AND (li->>'kind') IN ('required', 'opt_in')
  GROUP BY bc.id, bc.name, bc.start_date, li->>'name', li->>'kind', c.name
  ORDER BY bc.start_date;
$$;

GRANT EXECUTE ON FUNCTION public.analytics_term_series(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_fee_series(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_discount_series(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_class_series(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_month_series(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_fee_class_series(uuid) TO authenticated;
