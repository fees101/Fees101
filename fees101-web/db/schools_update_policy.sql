-- Fix: school owners could not persist ANY change to their own school row.
--
-- The `schools` table had RLS enabled with only two policies:
--   * "Super admin manages schools" — USING (is_super_admin())  [covers ALL cmds, super-admin only]
--   * "Users see own school"        — FOR SELECT                [read only]
-- There was NO UPDATE policy for a regular school_admin. So a school owner's
-- UPDATE matched zero rows and PostgREST/Supabase returned {error: null} — a
-- silent no-op. This broke every settings write (reminders, general profile,
-- logo, payment provider credentials, discount config), which all UPDATE the
-- `schools.settings` / `schools` row through the RLS-scoped user client.
-- Symptom seen: the reminders toggle "sprang back on" and the audit log recorded
-- the change while schools.settings stayed empty.
--
-- Mirrors the existing "School admin manages <table>" convention used across
-- classes, billing_cycles, discounts, etc. Scope is FOR UPDATE only — schools
-- are created at signup and removed via the (service-role) deletion flow, so a
-- school_admin needs neither INSERT nor DELETE here. WITH CHECK keeps them from
-- repointing the row to another tenant.
--
-- Idempotent: safe to re-run.

DROP POLICY IF EXISTS "School admin updates own school" ON public.schools;

CREATE POLICY "School admin updates own school" ON public.schools
  FOR UPDATE
  USING (
    (id = public.current_school_id())
    AND (EXISTS (
      SELECT 1
      FROM public.users
      WHERE ((users.id = auth.uid()) AND (users.role = 'school_admin'::text))
    ))
  )
  WITH CHECK (id = public.current_school_id());
