-- RLS privilege-escalation & deactivation fixes.
-- Found via impersonation stress-testing the permission-based RLS:
--   1. CRITICAL: "Users update self" had no WITH CHECK, so any user could edit
--      privileged columns on their own row (self-promote to school_admin,
--      change role_id, flip is_active back on after deactivation, or move
--      themselves into another school_id).
--   2. is_school_owner()/is_super_admin() didn't check is_active, so a
--      deactivated owner kept full write access at the RLS layer.
--   3. current_school_id() didn't check is_active, so a deactivated user kept
--      read (and, via the owner branch, write) access to their school's data
--      via a direct API call with a still-valid JWT.
--
-- Fixes 2 & 3 flow through every policy that keys off these helpers, so a
-- deactivated user loses all read+write access at the DB layer in one place.

-- 1. Scope-resolver: a deactivated user belongs to no school for RLS purposes.
create or replace function public.current_school_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select school_id from users where id = auth.uid() and is_active = true;
$$;

-- 2. Owner check must respect deactivation.
create or replace function public.is_school_owner()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from users
    where id = auth.uid() and is_active = true
      and role in ('school_admin','super_admin')
  );
$$;

-- 3. Super-admin check must respect deactivation.
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from users where id = auth.uid() and is_active = true and role = 'super_admin'
  );
$$;

-- 4. A self-update may only touch non-privileged columns. role / role_id /
--    is_active / school_id are pinned to their current stored values, so a user
--    can never escalate, reactivate, or move schools by editing their own row.
--    (Changing another user's role still goes through the carefully-checked
--    "Manage-team updates school users" policy; changing your own privileged
--    fields is an owner/super-admin action.)
drop policy if exists "Users update self" on public.users;
create policy "Users update self" on public.users
for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and role       is not distinct from (select u.role       from public.users u where u.id = auth.uid())
  and role_id    is not distinct from (select u.role_id    from public.users u where u.id = auth.uid())
  and is_active  is not distinct from (select u.is_active  from public.users u where u.id = auth.uid())
  and school_id  is not distinct from (select u.school_id  from public.users u where u.id = auth.uid())
);
