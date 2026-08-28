-- Recent Activity feed — a single, browsable, human-readable stream of the
-- operational events that happen in a school's account: money received,
-- invoices sent/generated, messages dispatched (reminders, receipts, invoice
-- deliveries), the discount lifecycle, and new students.
--
-- WHY A VIEW (not the audit_log): the audit_log answers "which staff member
-- changed what" — it only ever captures staff-initiated privileged mutations
-- and misses the events that matter most operationally: DVA/webhook payments
-- applied by the system with no human actor, and automated reminders. This view
-- unions the domain tables directly so system- and parent-driven events show up
-- too, and it resolves student/class/parent NAMES at query time so the UI never
-- has to display raw UUIDs.
--
-- SECURITY: created WITH (security_invoker = true) so the underlying tables' RLS
-- policies run as the querying user — each school sees only its own rows,
-- exactly as if it had queried the base tables. (Requires Postgres 15+, which
-- Supabase is on.) Every source table has RLS enabled and a "Users see own
-- school" SELECT policy, so no new policy is needed here.
--
-- Column shape is normalized across every branch (same types, same order) so the
-- UNION ALL type-checks. References are cast ::text because invoice_number is not
-- a text column. occurred_at is never null in any branch, so ORDER BY / range
-- pagination over the view is stable.
--
-- Idempotent: CREATE OR REPLACE. Re-run after any column change below.

CREATE OR REPLACE VIEW public.activity_feed
WITH (security_invoker = true) AS

  -- ── Payments received ────────────────────────────────────────────────────
  SELECT
    p.id::text || ':payment_received'          AS event_id,
    p.school_id                                AS school_id,
    'payments'::text                           AS category,
    'payment_received'::text                   AS event_type,
    p.paid_at                                  AS occurred_at,
    p.student_id                               AS student_id,
    btrim(s.first_name || ' ' || s.last_name)  AS student_name,
    c.name                                     AS class_name,
    f.primary_parent_name                      AS parent_name,
    p.amount                                   AS amount,
    p.provider_reference::text                 AS reference,
    NULL::text                                 AS channel,
    p.match_status                             AS status,
    ru.name                                    AS actor_name
  FROM public.payments p
  JOIN public.students s       ON s.id = p.student_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  LEFT JOIN public.users ru    ON ru.id = p.recorded_by

  UNION ALL

  -- ── Invoices sent ────────────────────────────────────────────────────────
  SELECT
    i.id::text || ':invoice_sent',
    i.school_id,
    'invoices'::text,
    'invoice_sent'::text,
    i.sent_at,
    i.student_id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    i.total_amount,
    i.invoice_number::text,
    NULL::text,
    i.status,
    NULL::text
  FROM public.invoices i
  JOIN public.students s       ON s.id = i.student_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  WHERE i.sent_at IS NOT NULL

  UNION ALL

  -- ── Invoices generated ───────────────────────────────────────────────────
  SELECT
    i.id::text || ':invoice_generated',
    i.school_id,
    'invoices'::text,
    'invoice_generated'::text,
    i.generated_at,
    i.student_id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    i.total_amount,
    i.invoice_number::text,
    NULL::text,
    i.status,
    NULL::text
  FROM public.invoices i
  JOIN public.students s       ON s.id = i.student_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id

  UNION ALL

  -- ── Messages dispatched (reminders, receipts, invoice deliveries, manual) ─
  -- Outbound only; the raw message_type carries through as the event_type so the
  -- UI can label each kind (reminder_overdue, receipt, invoice_full, …).
  SELECT
    m.id::text || ':message',
    m.school_id,
    'messages'::text,
    m.message_type,
    COALESCE(m.sent_at, m.created_at),
    m.related_student_id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    NULL::numeric,
    NULL::text,
    m.channel,
    m.status,
    NULL::text
  FROM public.message_logs m
  LEFT JOIN public.students s   ON s.id = m.related_student_id
  LEFT JOIN public.classes c    ON c.id = s.class_id
  LEFT JOIN public.families f   ON f.id = s.family_id
  WHERE m.direction = 'outbound'

  UNION ALL

  -- ── Discount requested ───────────────────────────────────────────────────
  SELECT
    d.id::text || ':discount_requested',
    d.school_id,
    'discounts'::text,
    'discount_requested'::text,
    d.requested_at,
    d.student_id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    d.amount,
    d.category::text,
    NULL::text,
    d.status,
    ru.name
  FROM public.discounts d
  JOIN public.students s       ON s.id = d.student_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  LEFT JOIN public.users ru    ON ru.id = d.requested_by
  WHERE d.requested_at IS NOT NULL

  UNION ALL

  -- ── Discount approved ────────────────────────────────────────────────────
  SELECT
    d.id::text || ':discount_approved',
    d.school_id,
    'discounts'::text,
    'discount_approved'::text,
    d.approved_at,
    d.student_id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    d.amount,
    d.category::text,
    NULL::text,
    d.status,
    au.name
  FROM public.discounts d
  JOIN public.students s       ON s.id = d.student_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  LEFT JOIN public.users au    ON au.id = d.approved_by
  WHERE d.approved_at IS NOT NULL

  UNION ALL

  -- ── Discount rejected ────────────────────────────────────────────────────
  SELECT
    d.id::text || ':discount_rejected',
    d.school_id,
    'discounts'::text,
    'discount_rejected'::text,
    d.rejected_at,
    d.student_id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    d.amount,
    d.category::text,
    NULL::text,
    d.status,
    rju.name
  FROM public.discounts d
  JOIN public.students s       ON s.id = d.student_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  LEFT JOIN public.users rju   ON rju.id = d.rejected_by
  WHERE d.rejected_at IS NOT NULL

  UNION ALL

  -- ── Discount applied ─────────────────────────────────────────────────────
  SELECT
    d.id::text || ':discount_applied',
    d.school_id,
    'discounts'::text,
    'discount_applied'::text,
    d.applied_at,
    d.student_id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    d.amount,
    d.category::text,
    NULL::text,
    d.status,
    NULL::text
  FROM public.discounts d
  JOIN public.students s       ON s.id = d.student_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  WHERE d.applied_at IS NOT NULL

  UNION ALL

  -- ── Student added ────────────────────────────────────────────────────────
  SELECT
    s.id::text || ':student_added',
    s.school_id,
    'students'::text,
    'student_added'::text,
    s.created_at,
    s.id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    NULL::numeric,
    s.admission_number::text,
    NULL::text,
    s.status,
    NULL::text
  FROM public.students s
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id;

-- PostgREST reaches the view as the `authenticated` role; grant it read access.
-- (security_invoker means the base-table RLS still scopes rows per school.)
GRANT SELECT ON public.activity_feed TO authenticated;
