-- Two separate fixes bundled here since both were flagged in the same audit pass:
--
-- 1. student_fee_adjustments: genuinely over-permissive. Its only policy
--    (school_admins_manage_adjustments) checks nothing but school
--    membership — any staff member, regardless of permissions, can write.
--    Tightened to match the two code paths that actually write here:
--    fees/structure/actions.ts (manage-fee-structure) and
--    toggleStudentOptIn/setStudentExemption/removeStudentExemption in
--    students/[id]/actions.ts (manage-students, via getStudentFeeContext's
--    default).
--
-- 2. sessions: NOT over-permissive as originally flagged — the opposite.
--    Its insert/update/delete policies still check the literal
--    role IN ('school_admin','super_admin'), the same stale-check bug
--    already fixed elsewhere. A bursar holding a delegated
--    manage-fee-structure/manage-invoices/run-year-end permission is
--    currently silently blocked from writing session rows (starting a new
--    academic session, closing one during year-end rollover). Fixed to
--    match the actual permission gates used across fees/cycles/actions.ts
--    and fees/year-end/actions.ts. The existing "Super admin manages all
--    sessions" and "Users can view sessions of their school" policies are
--    untouched — both already correct.
--
-- Idempotent: safe to re-run.

DROP POLICY IF EXISTS "school_admins_manage_adjustments" ON public.student_fee_adjustments;
CREATE POLICY "school_admins_manage_adjustments" ON public.student_fee_adjustments
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-fee-structure') OR public.has_permission('manage-students'))
  )
  WITH CHECK (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-fee-structure') OR public.has_permission('manage-students'))
  );

DROP POLICY IF EXISTS "School admins can insert sessions" ON public.sessions;
CREATE POLICY "School admins can insert sessions" ON public.sessions
  FOR INSERT
  WITH CHECK (
    school_id = public.current_school_id()
    AND (
      public.is_school_owner()
      OR public.has_permission('manage-fee-structure')
      OR public.has_permission('manage-invoices')
      OR public.has_permission('run-year-end')
    )
  );

DROP POLICY IF EXISTS "School admins can update sessions" ON public.sessions;
CREATE POLICY "School admins can update sessions" ON public.sessions
  FOR UPDATE
  USING (
    school_id = public.current_school_id()
    AND (
      public.is_school_owner()
      OR public.has_permission('manage-fee-structure')
      OR public.has_permission('manage-invoices')
      OR public.has_permission('run-year-end')
    )
  );

DROP POLICY IF EXISTS "School admins can delete sessions" ON public.sessions;
CREATE POLICY "School admins can delete sessions" ON public.sessions
  FOR DELETE
  USING (
    school_id = public.current_school_id()
    AND (
      public.is_school_owner()
      OR public.has_permission('manage-fee-structure')
      OR public.has_permission('manage-invoices')
      OR public.has_permission('run-year-end')
    )
  );
