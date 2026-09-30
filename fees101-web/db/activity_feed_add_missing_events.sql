-- Adds three event kinds to the activity_feed view that are already recorded
-- in audit_log but have no counterpart in the feed: invoice cancellations,
-- student status changes, and credit-balance adjustments. None of these has
-- a dedicated timestamp column on its own domain table to union against (an
-- invoice's cancellation isn't distinguishable from any other update via
-- invoices.updated_at, students.updated_at fires on any profile edit not
-- just a status change, and credit_balance is a running total with no
-- history table) — audit_log is the only place these events exist as
-- discrete, timestamped rows, so these three branches source from it
-- specifically (not a generic audit_log passthrough, which would duplicate
-- everything the view below already covers from the domain tables).
--
-- This is a straight CREATE OR REPLACE of the full view from
-- db/activity_feed_view.sql, with the three new branches added. Run this
-- once in the Supabase SQL editor — it supersedes the earlier file.

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

  -- ── Invoices cancelled ───────────────────────────────────────────────────
  -- Sourced from audit_log (target_type='invoice'), not the invoices table —
  -- a cancelled invoice's own updated_at isn't a reliable "when was it
  -- cancelled" signal on its own.
  SELECT
    al.id::text || ':invoice_cancelled',
    al.school_id,
    'invoices'::text,
    'invoice_cancelled'::text,
    al.created_at,
    i.student_id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    i.total_amount,
    i.invoice_number::text,
    NULL::text,
    i.status,
    al.actor_name
  FROM public.audit_log al
  JOIN public.invoices i       ON i.id = al.target_id
  JOIN public.students s       ON s.id = i.student_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  WHERE al.action = 'invoice.cancelled'

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
  LEFT JOIN public.families f  ON f.id = s.family_id

  UNION ALL

  -- ── Student status changed ───────────────────────────────────────────────
  -- Sourced from audit_log — students.updated_at fires on any profile edit,
  -- not just a status transition, so it can't be used to date this event.
  -- reference carries the old status, status carries the new one.
  SELECT
    al.id::text || ':student_status_changed',
    al.school_id,
    'students'::text,
    'student_status_changed'::text,
    al.created_at,
    s.id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    NULL::numeric,
    al.metadata->>'oldStatus',
    NULL::text,
    al.metadata->>'newStatus',
    al.actor_name
  FROM public.audit_log al
  JOIN public.students s       ON s.id = al.target_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  WHERE al.action = 'student.status_changed'

  UNION ALL

  -- ── Credit balance adjusted ──────────────────────────────────────────────
  -- credit_balance is a running total with no history table, so a real
  -- adjustment event only exists as an audit_log row. Scoped to the "credit"
  -- decision only — "leave" resolves the overage without touching the
  -- balance, so it isn't an adjustment.
  SELECT
    al.id::text || ':credit_balance_adjusted',
    al.school_id,
    'students'::text,
    'credit_balance_adjusted'::text,
    al.created_at,
    s.id,
    btrim(s.first_name || ' ' || s.last_name),
    c.name,
    f.primary_parent_name,
    (al.metadata->>'overage')::numeric,
    NULL::text,
    NULL::text,
    al.metadata->>'decision',
    al.actor_name
  FROM public.audit_log al
  JOIN public.students s       ON s.id = al.target_id
  LEFT JOIN public.classes c   ON c.id = s.class_id
  LEFT JOIN public.families f  ON f.id = s.family_id
  WHERE al.action = 'student.opt_out_overage_resolved'
    AND al.metadata->>'decision' = 'credit';

-- PostgREST reaches the view as the `authenticated` role; grant it read access.
-- (security_invoker means the base-table RLS still scopes rows per school.)
GRANT SELECT ON public.activity_feed TO authenticated;
