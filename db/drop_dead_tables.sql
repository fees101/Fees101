-- Drop confirmed-dead tables: zero references anywhere in src/, confirmed
-- by two independent audit passes.
--
-- refunds is deliberately NOT included — kept per an earlier decision even
-- though it's also unreferenced, in case any refund was ever logged there
-- outside the app.
--
-- Before running this, take a quick backup of each table's data just in
-- case (Supabase dashboard: Table Editor -> table -> Export to CSV, or
-- `pg_dump --data-only -t <table>` if you have direct DB access). None of
-- these should hold real data, but the check is cheap and this is
-- irreversible.

DROP TABLE IF EXISTS public.pending_approvals;
DROP TABLE IF EXISTS public.inbound_requests;
DROP TABLE IF EXISTS public.receipts;
DROP TABLE IF EXISTS public.audit_logs;
