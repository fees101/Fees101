-- Read-only platform-admin impersonation ("View as this school").
--
-- Lets a platform admin (fees101-console) assume a school's view in
-- fees101-web without ever becoming that user: the session row below records
-- WHO (the real platform admin) is viewing WHICH school, as WHOM (display
-- only), and for how long. current_school_id() (redefined below) picks this
-- session up automatically so every existing RLS policy keyed off it starts
-- scoping reads to the impersonated school with no policy changes. Writes are
-- blocked at the application layer (see can() in src/lib/auth/permissions.ts)
-- — this is deliberately the load-bearing control, not RLS; RLS still allows
-- WITH CHECK writes under the same current_school_id() by design (see the
-- comment on the function below).
--
-- Checked against the LIVE production schema before writing this (the
-- committed db/platform_dashboard_schema.sql is known stale) via the
-- PostgREST OpenAPI root (GET /rest/v1/ -> definitions.platform_audit_log):
-- platform_audit_log currently has id, actor_name, action, school_id,
-- summary, metadata, created_at — NO actor_id, even though both
-- fees101-console (schools/[id]/actions.ts, onboarding/actions.ts) and
-- fees101-web (team/data-privacy/actions.ts) already insert actor_id on every
-- call. Those inserts have been silently failing (errors unchecked) since
-- whenever actor_id was added to the code without a matching column ever
-- being created. This migration adds the missing column.

-- 1. Reconcile platform_audit_log with what the app has been inserting.
alter table public.platform_audit_log
  add column if not exists actor_id uuid references auth.users(id) on delete set null;

-- 2. The impersonation session ledger itself.
create table if not exists public.impersonation_sessions (
  id                    uuid primary key default gen_random_uuid(),
  platform_admin_id    uuid not null references public.platform_admins(id) on delete cascade,
  platform_admin_name  text not null,
  platform_admin_email text not null,
  target_school_id     uuid not null references public.schools(id) on delete cascade,
  target_school_name   text not null,
  target_user_id       uuid references public.users(id) on delete set null,
  target_user_name     text,
  started_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  ended_at     timestamptz,
  ended_reason text,
  created_at   timestamptz not null default now()
);

create index if not exists impersonation_sessions_active_admin_idx
  on public.impersonation_sessions (platform_admin_id) where ended_at is null;
create index if not exists impersonation_sessions_school_idx
  on public.impersonation_sessions (target_school_id, started_at desc);

alter table public.impersonation_sessions enable row level security;
-- No policies, deliberately — same pattern as platform_admins / platform_billing
-- / platform_audit_log: this table is only ever touched via the service-role
-- client (fees101-console to start a session, fees101-web to end one), never
-- via the anon/authenticated PostgREST role directly.

-- 3. current_school_id(): read a confirmed-active impersonation session first
-- (so an impersonating platform admin's reads are scoped to the target
-- school via existing RLS, no policy rewrites needed), otherwise fall back to
-- the normal "my own school" lookup. Preserves the original definition
-- (db/rls_privilege_fixes.sql) exactly for the non-impersonating path.
--
-- NOTE: this intentionally does not change what writes RLS allows — a row
-- satisfying `school_id = current_school_id()` still passes WITH CHECK during
-- an active impersonation session. That's fine: per the approved plan, the
-- write block for impersonation is enforced at the application layer (can()
-- in src/lib/auth/permissions.ts), which is the actual load-bearing control
-- here, not RLS.
create or replace function public.current_school_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select target_school_id from impersonation_sessions
       where platform_admin_id = auth.uid() and ended_at is null and expires_at > now()
       order by started_at desc limit 1),
    (select school_id from users where id = auth.uid() and is_active = true)
  );
$$;

notify pgrst, 'reload schema';
