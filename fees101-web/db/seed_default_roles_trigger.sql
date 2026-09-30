-- =====================================================================
-- Auto-seed default roles for every new school.
--
-- db/roles_permissions.sql seeded "Administrator" and "Bursar" system
-- roles for schools that existed at the time it ran, via a one-off
-- `insert ... select from schools`. Any school created after that
-- migration (there's no self-serve signup — the owner provisions
-- schools directly against the DB) got zero rows in `roles`: the
-- Roles & permissions page renders completely empty for it, and there's
-- no ready-made Bursar role to hand a new staff member.
--
-- This trigger makes the seeding automatic and permanent, so it can
-- never again depend on remembering to run a migration by hand. Run
-- once in the Supabase SQL editor.
-- =====================================================================

create or replace function public.seed_default_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roles (school_id, name, description, is_system, is_admin, permissions)
  values (new.id, 'Administrator', 'Full access to everything', true, true, '{}'::jsonb);

  insert into public.roles (school_id, name, description, is_system, is_admin, permissions)
  values (new.id, 'Bursar', 'Day-to-day fee operations', true, false,
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
      'manage-reminder-config',     false, 'manage-team',                false));

  return new;
end;
$$;

drop trigger if exists schools_seed_default_roles on public.schools;
create trigger schools_seed_default_roles after insert on public.schools
  for each row execute function public.seed_default_roles();

-- Back-fill any school created between the one-off migration and this
-- trigger (e.g. the "Greenfield Comprehensive Academy" test school).
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
