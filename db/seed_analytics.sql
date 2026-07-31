-- =====================================================================
-- SEED DATA for testing the /payments analytics page
-- =====================================================================
-- Creates an isolated demo school ("Demo Academy (seed)") with a fixed id so
-- this script is fully idempotent: re-running wipes and rebuilds only this
-- school's data and never touches your real tenant(s).
--
-- Dataset:
--   • 4 sessions (2021/2022 → 2024/2025); the last is active/current
--   • 3 terms per session + a "Summer Coaching" period in 2023/2024 (13 cycles)
--   • past cycles are 'closed'; 2024/2025 First Term is 'active'; its 2nd/3rd
--     terms are 'draft' (not yet started — no invoices), like real life
--   • 9 classes, 40 students (a few withdrawn), some on recurring discounts
--   • invoices per student per cycle with required + opt-in line items,
--     realistic mix of paid / partial / unpaid, plus dated payments
--
-- HOW TO USE
--   1. Run this whole file in the Supabase SQL editor.
--   2. Point your login at the demo school so /payments resolves it:
--        update public.users
--        set school_id = '5eed5eed-0000-4000-8000-000000000001'
--        where email = 'YOUR_LOGIN_EMAIL';
--      (To go back to your real data later, set school_id back — or NULL if
--       you're a super_admin and rely on the first-school fallback.)
--   3. Make sure db/analytics_functions.sql has been run, then open /payments.
--
-- TO REMOVE: re-run just the DELETE block at the top (or drop the school row).
-- =====================================================================

BEGIN;

-- ---- Clean up any previous seed (child rows first for FK safety) ----------
DELETE FROM public.payments               WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.discounts              WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.invoices               WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.student_fee_adjustments WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.fee_items              WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.students               WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.billing_cycles         WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.sessions               WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.classes                WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.sections               WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.families               WHERE school_id = '5eed5eed-0000-4000-8000-000000000001';
DELETE FROM public.schools                WHERE id        = '5eed5eed-0000-4000-8000-000000000001';

-- ---- School + section ----------------------------------------------------
INSERT INTO public.schools (id, name, academic_year, subscription_status)
VALUES ('5eed5eed-0000-4000-8000-000000000001', 'Demo Academy (seed)', '2024/2025', 'active');

INSERT INTO public.sections (id, school_id, name, display_order)
VALUES ('5eed5eed-0000-4000-8000-000000000010', '5eed5eed-0000-4000-8000-000000000001', 'Main', 0);

-- ---- Classes -------------------------------------------------------------
INSERT INTO public.classes (id, school_id, section_id, name, display_order)
SELECT gen_random_uuid(), '5eed5eed-0000-4000-8000-000000000001',
       '5eed5eed-0000-4000-8000-000000000010', x.name, x.ord
FROM (VALUES
  ('Primary 1', 1), ('Primary 2', 2), ('Primary 3', 3),
  ('Primary 4', 4), ('Primary 5', 5), ('Primary 6', 6),
  ('JSS 1', 7), ('JSS 2', 8), ('JSS 3', 9)
) x(name, ord);

-- ---- Students (40; a few withdrawn; some on recurring discounts) ----------
INSERT INTO public.students
  (id, school_id, section_id, class_id, first_name, last_name,
   admission_number, status, special_category, admission_date, created_at, updated_at)
SELECT gen_random_uuid(),
       '5eed5eed-0000-4000-8000-000000000001',
       '5eed5eed-0000-4000-8000-000000000010',
       cl.id,
       'Student', 'No' || g,
       'SEED-' || lpad(g::text, 4, '0'),
       CASE WHEN g % 17 = 0 THEN 'withdrawn' ELSE 'active' END,
       CASE
         WHEN g % 11 = 0 THEN 'scholarship'
         WHEN g % 7  = 0 THEN 'staff_child'
         WHEN g % 13 = 0 THEN 'bursary'
         WHEN g % 5  = 0 THEN 'sibling'
         ELSE NULL
       END,
       CURRENT_DATE, now(), now()
FROM generate_series(1, 40) g
JOIN LATERAL (
  SELECT id FROM public.classes
  WHERE school_id = '5eed5eed-0000-4000-8000-000000000001'
  ORDER BY display_order OFFSET (g % 9) LIMIT 1
) cl ON true;

-- ---- Sessions ------------------------------------------------------------
INSERT INTO public.sessions (id, school_id, name, start_date, end_date, status)
VALUES
  (gen_random_uuid(), '5eed5eed-0000-4000-8000-000000000001', '2021/2022', '2021-09-01', '2022-07-31', 'closed'),
  (gen_random_uuid(), '5eed5eed-0000-4000-8000-000000000001', '2022/2023', '2022-09-01', '2023-07-31', 'closed'),
  (gen_random_uuid(), '5eed5eed-0000-4000-8000-000000000001', '2023/2024', '2023-09-01', '2024-08-31', 'closed'),
  (gen_random_uuid(), '5eed5eed-0000-4000-8000-000000000001', '2024/2025', '2024-09-01', '2025-07-31', 'active');

-- ---- Billing cycles (terms) ---------------------------------------------
INSERT INTO public.billing_cycles
  (id, school_id, session_id, name, start_date, end_date, due_date, status)
SELECT gen_random_uuid(), '5eed5eed-0000-4000-8000-000000000001', se.id,
       v.cname, v.sd::date, v.ed::date, v.dd::date, v.st
FROM (VALUES
  ('2021/2022', '2021/2022 First Term',  '2021-09-01', '2021-12-15', '2021-09-30', 'closed'),
  ('2021/2022', '2021/2022 Second Term', '2022-01-10', '2022-04-10', '2022-01-31', 'closed'),
  ('2021/2022', '2021/2022 Third Term',  '2022-04-25', '2022-07-31', '2022-05-15', 'closed'),
  ('2022/2023', '2022/2023 First Term',  '2022-09-01', '2022-12-15', '2022-09-30', 'closed'),
  ('2022/2023', '2022/2023 Second Term', '2023-01-10', '2023-04-10', '2023-01-31', 'closed'),
  ('2022/2023', '2022/2023 Third Term',  '2023-04-25', '2023-07-31', '2023-05-15', 'closed'),
  ('2023/2024', '2023/2024 First Term',  '2023-09-01', '2023-12-15', '2023-09-30', 'closed'),
  ('2023/2024', '2023/2024 Second Term', '2024-01-10', '2024-04-10', '2024-01-31', 'closed'),
  ('2023/2024', '2023/2024 Third Term',  '2024-04-25', '2024-06-25', '2024-05-15', 'closed'),
  ('2023/2024', '2023/2024 Summer Coaching', '2024-07-01', '2024-08-20', '2024-07-10', 'closed'),
  ('2024/2025', '2024/2025 First Term',  '2024-09-01', '2024-12-15', '2024-09-30', 'active'),
  ('2024/2025', '2024/2025 Second Term', '2025-01-10', '2025-04-10', '2025-01-31', 'draft'),
  ('2024/2025', '2024/2025 Third Term',  '2025-04-25', '2025-07-31', '2025-05-15', 'draft')
) v(sname, cname, sd, ed, dd, st)
JOIN public.sessions se
  ON se.school_id = '5eed5eed-0000-4000-8000-000000000001' AND se.name = v.sname;

-- ---- Fee items (per cycle that has invoices) -----------------------------
INSERT INTO public.fee_items
  (id, school_id, billing_cycle_id, class_id, name, amount, is_mandatory, is_optional_extra, display_order)
SELECT gen_random_uuid(), '5eed5eed-0000-4000-8000-000000000001', bc.id, NULL,
       t.name, t.amount, t.mand, t.opt, t.ord
FROM public.billing_cycles bc
CROSS JOIN (VALUES
  ('Tuition',          150000, true,  false, 1),
  ('Development Levy',  20000, true,  false, 2),
  ('Transport',         30000, false, true,  3),
  ('Lunch',             25000, false, true,  4)
) t(name, amount, mand, opt, ord)
WHERE bc.school_id = '5eed5eed-0000-4000-8000-000000000001'
  AND bc.status IN ('closed', 'active');

-- ---- Invoices ------------------------------------------------------------
-- One invoice per (student, cycle) for every cycle that has invoices. Amounts
-- grow ~10% per session; tuition scales with class tier. Opt-ins vary by
-- student. Collection is high for closed terms, lower for the active term.
WITH si AS (
  SELECT st.id AS student_id, st.special_category, cl.display_order AS tier,
         row_number() OVER (ORDER BY st.admission_number) AS s_idx
  FROM public.students st
  JOIN public.classes cl ON cl.id = st.class_id
  WHERE st.school_id = '5eed5eed-0000-4000-8000-000000000001'
),
ci AS (
  SELECT bc.id AS cycle_id, bc.status, bc.start_date,
         dense_rank() OVER (ORDER BY se.start_date) AS sess_rank,
         row_number() OVER (ORDER BY bc.start_date) AS c_idx
  FROM public.billing_cycles bc
  JOIN public.sessions se ON se.id = bc.session_id
  WHERE bc.school_id = '5eed5eed-0000-4000-8000-000000000001'
    AND bc.status IN ('closed', 'active')
),
calc AS (
  SELECT si.student_id, si.special_category, si.s_idx,
         ci.cycle_id, ci.status, ci.start_date, ci.c_idx,
         (1 + (ci.sess_rank - 1) * 0.1) AS mult,
         (150000 + (si.tier - 1) * 8000) AS tuition_base,
         (si.s_idx % 2 = 0) AS has_transport,
         (si.s_idx % 3 = 0) AS has_lunch,
         CASE si.special_category
           WHEN 'scholarship' THEN 75 WHEN 'staff_child' THEN 50
           WHEN 'bursary' THEN 40 WHEN 'sibling' THEN 10 ELSE 0 END AS disc_pct
  FROM si CROSS JOIN ci
),
amt AS (
  SELECT *,
    round(tuition_base * mult, 2) AS tuition,
    round(20000 * mult, 2) AS dev,
    round(30000 * mult, 2) AS transport,
    round(25000 * mult, 2) AS lunch
  FROM calc
),
sub AS (
  SELECT *,
    tuition + dev
      + CASE WHEN has_transport THEN transport ELSE 0 END
      + CASE WHEN has_lunch THEN lunch ELSE 0 END AS subtotal
  FROM amt
),
tot AS (
  SELECT *,
    round(subtotal * disc_pct / 100.0, 2) AS discount_amount,
    subtotal - round(subtotal * disc_pct / 100.0, 2) AS total_amount,
    ((s_idx * 7 + c_idx * 3) % 10) AS r
  FROM sub
),
final AS (
  SELECT *,
    CASE
      WHEN status = 'active' THEN
        CASE WHEN r < 3 THEN total_amount
             WHEN r < 6 THEN round(total_amount * 0.5, 2)
             WHEN r < 8 THEN round(total_amount * 0.2, 2)
             ELSE 0 END
      ELSE
        CASE WHEN r < 6 THEN total_amount
             WHEN r < 8 THEN round(total_amount * 0.5, 2)
             WHEN r < 9 THEN round(total_amount * 0.2, 2)
             ELSE 0 END
    END AS paid_amount
  FROM tot
)
INSERT INTO public.invoices
  (id, school_id, student_id, billing_cycle_id, line_items,
   discount_amount, discount_reason, subtotal, total_amount, paid_amount,
   status, generated_at, created_at, updated_at)
SELECT gen_random_uuid(), '5eed5eed-0000-4000-8000-000000000001', student_id, cycle_id,
  jsonb_build_array(
    jsonb_build_object('name', 'Tuition',         'amount', tuition, 'kind', 'required'),
    jsonb_build_object('name', 'Development Levy', 'amount', dev,     'kind', 'required')
  )
  || CASE WHEN has_transport
       THEN jsonb_build_array(jsonb_build_object('name', 'Transport', 'amount', transport, 'kind', 'opt_in'))
       ELSE '[]'::jsonb END
  || CASE WHEN has_lunch
       THEN jsonb_build_array(jsonb_build_object('name', 'Lunch', 'amount', lunch, 'kind', 'opt_in'))
       ELSE '[]'::jsonb END,
  discount_amount,
  CASE WHEN disc_pct > 0
       THEN 'Seeded ' || special_category || ' discount for analytics testing'
       ELSE NULL END,
  subtotal, total_amount, paid_amount,
  CASE WHEN total_amount > 0 AND paid_amount >= total_amount THEN 'paid'
       WHEN paid_amount > 0 THEN 'partial'
       ELSE 'pending' END,
  start_date, start_date, now()
FROM final;

-- ---- Payments (dated within the term, for month-level granularity) --------
INSERT INTO public.payments
  (id, school_id, invoice_id, student_id, amount, method, paid_at, match_status, created_at, updated_at)
SELECT gen_random_uuid(), i.school_id, i.id, i.student_id, i.paid_amount, 'provider_dva',
       i.generated_at + make_interval(days => (abs(hashtext(i.id::text)) % 70)),
       'matched', now(), now()
FROM public.invoices i
WHERE i.school_id = '5eed5eed-0000-4000-8000-000000000001'
  AND i.paid_amount > 0;

-- ---- Discounts (one recurring, applied discount per discounted invoice) ---
INSERT INTO public.discounts
  (id, school_id, invoice_id, student_id, amount, category, reason, status,
   is_percentage, is_recurring, requested_at, approved_at, applied_at, created_at, updated_at)
SELECT gen_random_uuid(), i.school_id, i.id, i.student_id,
  CASE st.special_category
    WHEN 'scholarship' THEN 75 WHEN 'staff_child' THEN 50
    WHEN 'bursary' THEN 40 WHEN 'sibling' THEN 10 END,
  CASE st.special_category WHEN 'sibling' THEN 'sibling_discount' ELSE st.special_category END,
  'Seeded ' || st.special_category || ' discount to exercise the analytics discount breakdown',
  'applied', true, true, i.generated_at, i.generated_at, i.generated_at, i.generated_at, now()
FROM public.invoices i
JOIN public.students st ON st.id = i.student_id
WHERE i.school_id = '5eed5eed-0000-4000-8000-000000000001'
  AND i.discount_amount > 0;

COMMIT;

-- ---- Quick sanity check --------------------------------------------------
SELECT
  (SELECT count(*) FROM public.sessions       WHERE school_id = '5eed5eed-0000-4000-8000-000000000001') AS sessions,
  (SELECT count(*) FROM public.billing_cycles WHERE school_id = '5eed5eed-0000-4000-8000-000000000001') AS cycles,
  (SELECT count(*) FROM public.students       WHERE school_id = '5eed5eed-0000-4000-8000-000000000001') AS students,
  (SELECT count(*) FROM public.invoices       WHERE school_id = '5eed5eed-0000-4000-8000-000000000001') AS invoices,
  (SELECT count(*) FROM public.payments       WHERE school_id = '5eed5eed-0000-4000-8000-000000000001') AS payments,
  (SELECT count(*) FROM public.discounts      WHERE school_id = '5eed5eed-0000-4000-8000-000000000001') AS discounts;
