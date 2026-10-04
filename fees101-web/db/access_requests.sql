-- Early-access lead capture for the marketing site (fees101.com/request-access).
--
-- Written ONLY by the marketing site's server-side route handler
-- (fees101-marketing/src/app/api/request-access/route.ts), which inserts via
-- PostgREST using the Supabase SERVICE ROLE key — never from the browser and
-- never with an anon key. Read only by staff/console (service role or a
-- future authenticated platform view).
--
-- RLS is enabled with ZERO policies on purpose: the service role bypasses RLS,
-- so "no policies" means "no anon/authenticated access at all," which is
-- correct for a table only ever touched server-to-server. This mirrors the
-- existing server-only tables (processed_provider_transactions,
-- webhook_events, login_attempts) — see db/webhook_and_provider_tables.sql.
--
-- Idempotent: safe to run more than once in the Supabase SQL editor.

create table if not exists public.access_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  school_name   text not null,
  contact_name  text not null,
  email         text not null,
  phone         text,
  student_count integer,
  message       text,
  source        text not null default 'marketing_site',
  status        text not null default 'new'
);

alter table public.access_requests enable row level security;

comment on table public.access_requests is
  'Early-access leads from the marketing site. Written only by the marketing '
  'request-access route via the Supabase service role (RLS on, no policies = '
  'no anon/authenticated access); read only by staff/console.';
