-- Live page updates via Supabase Realtime (ROADMAP: "Live page updates via
-- Supabase Realtime"). Every page today is server-rendered, fetch-once — a
-- payment landing via webhook (Monnify/Paystack) or another staff member's
-- edit only shows up after a manual refresh. useRealtimeRefresh
-- (src/lib/realtime/useRealtimeRefresh.ts) subscribes to postgres_changes on
-- these tables and calls router.refresh() so the existing server-rendered
-- pages just re-run with fresh data — no client-side data model needed.
--
-- Tables added: invoices, payments, discounts — the direct webhook/mutation
-- targets pages read from — plus every base table the activity_feed VIEW is
-- built from (message_logs, students, audit_log; invoices/payments/discounts
-- already covered), since Realtime can only subscribe to base tables, not
-- views (db/activity_feed_add_missing_events.sql has the current view
-- definition and its six source tables).
--
-- RLS: Realtime replays postgres_changes to a subscriber through the same
-- RLS the authenticated role would see on a normal SELECT, so this was
-- audited first, not assumed — every one of these tables has a "Users see
-- own school ..." (or equivalent) SELECT policy scoped by
-- school_id = current_school_id(), confirmed against fees101_schema.sql and
-- db/audit_log.sql. No gaps found.
--
-- supabase_realtime is created empty (no FOR TABLE / FOR ALL TABLES clause --
-- see fees101_schema.sql), so nothing was broadcasting before this.
--
-- REPLICA IDENTITY FULL: our client subscriptions filter on non-primary-key
-- columns (school_id, student_id, invoice_id, billing_cycle_id -- see
-- useRealtimeRefresh call sites). With the default replica identity (primary
-- key only), Postgres only writes the PK into the WAL for UPDATE/DELETE, so
-- Realtime can't evaluate a school_id/student_id filter -- or the RLS policy,
-- which is also school_id-based -- against those events, and an invoice going
-- paid (UPDATE) or a cancelled/deleted row (DELETE) would be silently dropped
-- for filtered subscribers. FULL makes Postgres log the whole old row so both
-- the filter and RLS resolve on every event type. INSERTs already carry the
-- full new row, so this only matters for UPDATE/DELETE, which is exactly the
-- "invoice went paid" / "payment matched" case these pages exist to show live.
-- Cost is extra WAL per UPDATE/DELETE, negligible at per-school volumes.
--
-- Run this once in the Supabase SQL editor.

ALTER TABLE public.invoices REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.discounts REPLICA IDENTITY FULL;
ALTER TABLE public.message_logs REPLICA IDENTITY FULL;
ALTER TABLE public.students REPLICA IDENTITY FULL;
ALTER TABLE public.audit_log REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- Whole-app coverage (added after the initial payments/invoices pass). Every
-- remaining page that renders server-fetched data is now live-refreshed too,
-- so nothing in the app needs a manual browser refresh. Each table below was
-- RLS-audited the same way as the six above: all have RLS ENABLED and a
-- school-scoped SELECT policy (school_id = current_school_id(), or id =
-- current_school_id() for the schools table itself), so Realtime replays
-- through the same per-school filter as a normal SELECT -- no cross-tenant
-- leak. REPLICA IDENTITY FULL for the same reason as above: our client
-- filters (and the RLS policies) are on non-primary-key columns, so UPDATE/
-- DELETE events need the full old row in the WAL to resolve.
--
-- Scoping column per table (what the client subscription filters on):
--   schools .......................... id           (the school row itself)
--   everything else below ............ school_id
--
-- Pages served:
--   billing_cycles, sessions ......... fees overview, cycles list, academic structure, year-end
--   fee_items, student_fee_adjustments fee structure editor
--   classes, sections ................ academic structure, fee structure, students list
--   users, roles ..................... staff list, roles & permissions
--   schools .......................... payment/reminder/discount settings (config)
--   families ......................... students list (parent), data & privacy counts
--   report_downloads ................. reports (async/other-staff generation)
--   school_deletion_requests ......... data & privacy (background deletion job)
--   rollover_runs .................... year-end rollover live progress
-- ---------------------------------------------------------------------------

ALTER TABLE public.billing_cycles REPLICA IDENTITY FULL;
ALTER TABLE public.fee_items REPLICA IDENTITY FULL;
ALTER TABLE public.student_fee_adjustments REPLICA IDENTITY FULL;
ALTER TABLE public.classes REPLICA IDENTITY FULL;
ALTER TABLE public.sections REPLICA IDENTITY FULL;
ALTER TABLE public.sessions REPLICA IDENTITY FULL;
ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.roles REPLICA IDENTITY FULL;
ALTER TABLE public.schools REPLICA IDENTITY FULL;
ALTER TABLE public.families REPLICA IDENTITY FULL;
ALTER TABLE public.report_downloads REPLICA IDENTITY FULL;
ALTER TABLE public.school_deletion_requests REPLICA IDENTITY FULL;
ALTER TABLE public.rollover_runs REPLICA IDENTITY FULL;

-- Publication membership, made idempotent so the whole file is safe to re-run.
-- Postgres has no ADD TABLE IF NOT EXISTS for publications, and the first six
-- tables were already added by the initial run of this file -- a bare re-run
-- would error with "relation is already member of publication". This loop adds
-- each table only if it isn't already a member, covering both the original six
-- and the whole-app set above.
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'invoices','payments','discounts','message_logs','students','audit_log',
    'billing_cycles','fee_items','student_fee_adjustments','classes','sections',
    'sessions','users','roles','schools','families','report_downloads',
    'school_deletion_requests','rollover_runs'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
