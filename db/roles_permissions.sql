-- =====================================================================
-- Users & Roles: custom, per-school configurable permissions.
-- Run once in the Supabase SQL editor.
--
-- Model: a `roles` table per school, each holding a fixed catalog of
-- permission switches in a `permissions` jsonb column. Users point at a
-- role via `users.role_id`. The existing `users.role` text stays as the
-- base type (super_admin | school_admin | bursar) because current_school_id()
-- and is_super_admin() depend on it, and owner/super_admin bypass everything.
--
-- Permissions are read LIVE on every request via has_permission() (not baked
-- into the JWT), so an admin's toggle change applies on the user's next request.
-- =====================================================================

-- 1. Roles table ------------------------------------------------------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  name        text not null,
  description text,
  is_system   boolean not null default false,  -- seeded Administrator/Bursar: not deletable
  is_admin    boolean not null default false,  -- Administrator: implicitly all-permissions
  permissions jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, name)
);
create index if not exists idx_roles_school on public.roles (school_id);
drop trigger if exists roles_updated_at on public.roles;
create trigger roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

-- 2. Link users to a role ---------------------------------------------
alter table public.users
  add column if not exists role_id uuid references public.roles(id) on delete set null;
create index if not exists idx_users_role_id on public.users (role_id);

-- 3. Live permission check (SECURITY DEFINER so it reads roles under RLS).
--    Owner + super_admin + any is_admin role short-circuit to true.
--    Deactivated users get false for everything.
create or replace function public.has_permission(perm text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from users u
    left join roles r on r.id = u.role_id
    where u.id = auth.uid() and u.is_active = true
      and ( u.role in ('super_admin','school_admin')
            or r.is_admin = true
            or coalesce((r.permissions ->> perm)::boolean, false) = true )
  );
$$;

-- 4. RLS for roles ----------------------------------------------------
alter table public.roles enable row level security;

drop policy if exists "Read roles in own school" on public.roles;
create policy "Read roles in own school" on public.roles for select
  using (school_id = public.current_school_id() or public.is_super_admin());

drop policy if exists "Manage-team writes roles" on public.roles;
create policy "Manage-team writes roles" on public.roles for all
  using ((school_id = public.current_school_id() and public.has_permission('manage-team')) or public.is_super_admin())
  with check ((school_id = public.current_school_id() and public.has_permission('manage-team')) or public.is_super_admin());

-- 5. Let manage-team users UPDATE other staff in their school (assign role,
--    deactivate). INSERT of new staff still goes through the service-role
--    client (the auth user must be created first), so no INSERT policy here.
drop policy if exists "Manage-team updates school users" on public.users;
create policy "Manage-team updates school users" on public.users for update
  using (school_id = public.current_school_id() and public.has_permission('manage-team'))
  with check (school_id = public.current_school_id() and public.has_permission('manage-team'));

-- 6. Allow the invite email type in message_logs ----------------------
alter table public.message_logs drop constraint if exists message_logs_message_type_check;
alter table public.message_logs add constraint message_logs_message_type_check
  check (message_type = any (array[
    'invoice','invoice_short','invoice_full','receipt',
    'reminder_advance','reminder_due','reminder_overdue',
    'extras_prompt','extras_confirmation','parent_query_response',
    'manual','inbound_parent','invite']));

-- 7. Seed default roles per school (idempotent; covers existing schools) --
insert into public.roles (school_id, name, description, is_system, is_admin, permissions)
select s.id, 'Administrator', 'Full access to everything', true, true, '{}'::jsonb
from public.schools s
where not exists (select 1 from public.roles r where r.school_id = s.id and r.name = 'Administrator');

insert into public.roles (school_id, name, description, is_system, is_admin, permissions)
select s.id, 'Bursar', 'Day-to-day fee operations', true, false,
  jsonb_build_object(
    'see-financial-totals',      true,  'see-analytics',             true,
    'see-reports',                true,  'see-students',              true,
    'see-discounts',              true,  'see-fee-structure',         true,
    'see-invoices',               true,
    'manage-students',            true,  'manage-fee-structure',      false,
    'manage-invoices',            true,  'request-discounts',         true,
    'approve-discounts',          false, 'run-year-end',               false,
    'manage-school-profile',      false, 'manage-academic-structure',  false,
    'manage-payment-config',      false, 'manage-discount-config',     false,
    'manage-reminder-config',     false, 'manage-team',                false)
from public.schools s
where not exists (select 1 from public.roles r where r.school_id = s.id and r.name = 'Bursar');

-- 8. Back-fill role_id for existing staff based on their current text role --
update public.users u set role_id = r.id from public.roles r
where u.role = 'bursar' and u.school_id = r.school_id and r.name = 'Bursar' and u.role_id is null;

update public.users u set role_id = r.id from public.roles r
where u.role = 'school_admin' and u.school_id = r.school_id and r.name = 'Administrator' and u.role_id is null;

-- 9. Consolidated permission catalog migration (one-time, safe to re-run) --
-- Collapses the old 15-key + dependency-graph catalog into the new flat,
-- standalone 18-key catalog. Never silently strips a capability a role
-- already had — merged keys are OR'd together. See ROADMAP/plan notes for
-- the full old->new key mapping and rationale.
--
-- Guarded to only rows still carrying an old-only key name (import-students,
-- generate-invoices, manage-settings, record-payments — none of which exist
-- in the new catalog). Without this guard, re-running against a role already
-- saved in the new format would misread its new-meaning `manage-fee-structure`
-- value as the old one and silently overwrite manually-set see-fee-structure/
-- see-invoices/manage-invoices/run-year-end back to false.
update public.roles set permissions = jsonb_build_object(
  'see-financial-totals', coalesce((permissions->>'see-financial-totals')::boolean, false),
  'see-analytics',        coalesce((permissions->>'see-analytics')::boolean, false),
  'see-reports',          coalesce((permissions->>'see-reports')::boolean, false),
  'see-students',         coalesce((permissions->>'see-students')::boolean, false),
  'see-discounts',        coalesce((permissions->>'see-discounts')::boolean, false),
  'see-fee-structure',    coalesce((permissions->>'manage-fee-structure')::boolean, false),
  'see-invoices',         coalesce((permissions->>'generate-invoices')::boolean, false)
                          or coalesce((permissions->>'request-discounts')::boolean, false),
  'manage-students',      coalesce((permissions->>'manage-students')::boolean, false)
                          or coalesce((permissions->>'import-students')::boolean, false),
  'manage-fee-structure', coalesce((permissions->>'manage-fee-structure')::boolean, false),
  'manage-invoices',      coalesce((permissions->>'manage-fee-structure')::boolean, false)
                          or coalesce((permissions->>'generate-invoices')::boolean, false),
  'request-discounts',    coalesce((permissions->>'request-discounts')::boolean, false),
  'approve-discounts',    coalesce((permissions->>'approve-discounts')::boolean, false),
  'run-year-end',         coalesce((permissions->>'run-year-end')::boolean, false)
                          or coalesce((permissions->>'manage-fee-structure')::boolean, false),
  'manage-school-profile',     coalesce((permissions->>'manage-settings')::boolean, false),
  'manage-academic-structure', coalesce((permissions->>'manage-settings')::boolean, false),
  'manage-payment-config',     coalesce((permissions->>'manage-settings')::boolean, false),
  'manage-discount-config',    coalesce((permissions->>'manage-settings')::boolean, false),
  'manage-reminder-config',    coalesce((permissions->>'manage-settings')::boolean, false),
  'manage-team',          coalesce((permissions->>'manage-team')::boolean, false)
)
where is_admin = false
  and (
    permissions ? 'import-students' or
    permissions ? 'generate-invoices' or
    permissions ? 'manage-settings' or
    permissions ? 'record-payments'
  );

-- 10. Owner-protection at the RLS level ---------------------------------
-- Everything above this line is unchanged. The app's server actions (see
-- settings/roles-permissions/actions.ts and settings/users/actions.ts) now
-- enforce: only the account owner (role = school_admin/super_admin) may
-- create/rename/delete a role or change its permissions, grant the
-- Administrator role, or deactivate/reassign the owner. Those checks alone
-- are NOT sufficient — a manage-team holder could bypass the Next.js app
-- entirely and call the Supabase REST API directly with their own session
-- token, since the RLS policies below (until this section) only ever
-- checked has_permission('manage-team'), with no owner or is_admin
-- awareness. This section closes that gap at the database itself, the one
-- layer that can't be routed around.
--
-- is_school_owner(): true only for the two base "owner" role values,
-- deliberately narrower than has_permission('manage-team') (which any
-- custom is_admin role or manage-team-flagged role also satisfies).
create or replace function public.is_school_owner()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from users where id = auth.uid() and role in ('school_admin','super_admin')
  );
$$;

-- Role CRUD (create/rename/delete/permission edits) is owner-only, full
-- stop — mirrors the app now refusing all four for anyone else. This is
-- what actually closes the "create a new role, grant it everything, move a
-- second account onto it" sock-puppet path: a manage-team holder can still
-- assign staff to roles the owner already built, but can no longer
-- fabricate or edit one, from the app or from a raw API call.
drop policy if exists "Manage-team writes roles" on public.roles;
drop policy if exists "Owner writes roles" on public.roles;
create policy "Owner writes roles" on public.roles for all
  using ((school_id = public.current_school_id() and public.is_school_owner()) or public.is_super_admin())
  with check ((school_id = public.current_school_id() and public.is_school_owner()) or public.is_super_admin());

-- Staff updates: a manage-team holder can still edit non-owner staff (role
-- reassignment, activate/deactivate) same as before, but now:
--   - can never touch the owner's own row at all (blocks deactivation AND
--     role reassignment of the owner, regardless of what the app sends),
--   - can never set role_id to an is_admin role unless they ARE the owner
--     (blocks promoting anyone, including themselves via a second account,
--     into Administrator by going straight to the API).
drop policy if exists "Manage-team updates school users" on public.users;
create policy "Manage-team updates school users" on public.users for update
  using (
    (school_id = public.current_school_id() and public.has_permission('manage-team') and role not in ('school_admin','super_admin'))
    or public.is_super_admin()
  )
  with check (
    (
      school_id = public.current_school_id() and public.has_permission('manage-team') and role not in ('school_admin','super_admin')
      and (
        role_id is null
        or public.is_school_owner()
        or not exists (select 1 from public.roles r where r.id = role_id and r.is_admin = true)
      )
    )
    or public.is_super_admin()
  );
