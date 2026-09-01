-- Fix: same delegation bug as db/permission_based_rls.sql, found on three
-- more tables during the "audit remaining tables" pass. Each still gated
-- writes on the literal role IN ('school_admin','bursar') check instead of
-- has_permission(), so a staff member holding a delegated custom-role
-- permission (not the literal bursar/school_admin role) is silently blocked
-- from writing here even though the app's requirePermission() check passes
-- and the UI lets them try.
--
-- Idempotent: safe to re-run.

-- 1. students — written under manage-students (create/edit/import/opt-in)
--    and run-year-end (promotion status/class_id updates during rollover).
DROP POLICY IF EXISTS "Staff manage students in own school" ON public.students;
CREATE POLICY "Staff manage students in own school" ON public.students
  USING (
    school_id = public.current_school_id()
    AND (
      public.is_school_owner()
      OR public.has_permission('manage-students')
      OR public.has_permission('run-year-end')
    )
  )
  WITH CHECK (
    school_id = public.current_school_id()
    AND (
      public.is_school_owner()
      OR public.has_permission('manage-students')
      OR public.has_permission('run-year-end')
    )
  );

-- 2. invoices — the broadest of the three: written from five different
--    permission-gated flows (manage-invoices, manage-fee-structure,
--    run-year-end, manage-students, approve-discounts).
DROP POLICY IF EXISTS "Staff manage invoices in own school" ON public.invoices;
CREATE POLICY "Staff manage invoices in own school" ON public.invoices
  USING (
    school_id = public.current_school_id()
    AND (
      public.is_school_owner()
      OR public.has_permission('manage-invoices')
      OR public.has_permission('manage-fee-structure')
      OR public.has_permission('run-year-end')
      OR public.has_permission('manage-students')
      OR public.has_permission('approve-discounts')
    )
  )
  WITH CHECK (
    school_id = public.current_school_id()
    AND (
      public.is_school_owner()
      OR public.has_permission('manage-invoices')
      OR public.has_permission('manage-fee-structure')
      OR public.has_permission('run-year-end')
      OR public.has_permission('manage-students')
      OR public.has_permission('approve-discounts')
    )
  );

-- 3. families — written only under manage-students (create/edit family,
--    notes updates alongside a student write).
DROP POLICY IF EXISTS "Staff manage families in own school" ON public.families;
CREATE POLICY "Staff manage families in own school" ON public.families
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-students'))
  )
  WITH CHECK (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-students'))
  );
