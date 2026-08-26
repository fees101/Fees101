-- Audit log — durable, queryable "who did what, when" trail for privileged
-- actions (staff/role/permission/discount/invoice changes). Distinct from
-- admin_notifications (a transient, dismissible notification inbox) and from
-- report_downloads (export history) — this is the permanent record.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  actor_id    uuid references public.users(id) on delete set null,
  actor_name  text not null,             -- denormalized at write time; survives actor deletion
  action      text not null,             -- e.g. 'staff.role_changed', 'discount.approved'
  target_type text,                      -- 'user' | 'role' | 'discount' | 'invoice'
  target_id   uuid,
  summary     text not null,             -- human-readable one-liner for the list view
  metadata    jsonb,                     -- structured before/after, reasons, etc.
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_school_created_idx
  on public.audit_log (school_id, created_at desc);

alter table public.audit_log enable row level security;

-- Same access model as report_downloads: a user sees/creates rows for their
-- own school; super_admins see everything.
create policy "Users see own school audit log"
  on public.audit_log for select
  using ((school_id = public.current_school_id()) or public.is_super_admin());

create policy "Users log own school audit events"
  on public.audit_log for insert
  with check ((school_id = public.current_school_id()) or public.is_super_admin());

create policy "Super admin manages all audit log"
  on public.audit_log
  using (public.is_super_admin());
