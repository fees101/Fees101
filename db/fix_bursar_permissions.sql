-- =====================================================================
-- Fix the seeded Bursar role: it was granting only 10 of the 15
-- permission keys a bursar actually needs, and was missing 'see-activity'
-- entirely (predates the current 21-key catalog). Found during the
-- whole-product permission audit against the App Shell canvas's Bursar
-- persona (2026-09-22), which expects:
--   see-financial-totals, see-analytics, see-reports, see-students,
--   see-discounts, see-fee-structure, see-invoices, see-activity,
--   manage-students, manage-fee-structure, manage-invoices,
--   request-discounts, approve-discounts, manage-academic-structure,
--   manage-reminder-config
--
-- This corrects both the go-forward trigger (db/seed_default_roles_trigger.sql)
-- and every already-seeded Bursar row. Run once in the Supabase SQL editor.
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
      'see-invoices',               true,  'see-activity',               true,
      'manage-students',            true,  'manage-fee-structure',      true,
      'manage-invoices',            true,  'request-discounts',         true,
      'approve-discounts',          true,  'run-year-end',               false,
      'manage-school-profile',      false, 'manage-academic-structure',  true,
      'manage-payment-config',      false, 'manage-discount-config',     false,
      'manage-reminder-config',     true,  'manage-team',                false));

  return new;
end;
$$;

-- Back-fill every already-seeded Bursar role with the 5 keys it was
-- missing, without disturbing anything a school may have since toggled
-- off for its own Bursar (jsonb '||' only adds/overwrites these keys).
update public.roles
set permissions = permissions || jsonb_build_object(
  'see-activity',               true,
  'manage-fee-structure',       true,
  'approve-discounts',          true,
  'manage-academic-structure',  true,
  'manage-reminder-config',     true
)
where name = 'Bursar' and is_system = true;
