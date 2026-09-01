-- Fix: RLS policies on several tables still gated writes on the literal
-- `users.role = 'school_admin'` text column, left over from before Roles &
-- Permissions (db/roles_permissions.sql) introduced has_permission(perm) as
-- the live, delegable permission check. A school owner can grant e.g.
-- `manage-academic-structure` to a non-owner custom role; the app's
-- requirePermission() check passes, the UI shows the button, the action
-- appears to run — but these policies still only matched school_admin/
-- super_admin, so the write silently matched zero rows (same failure class
-- as the schools-table bug fixed in db/schools_update_policy.sql, which is
-- itself superseded below to also account for delegated settings perms).
--
-- Every policy keeps its existing school_id/current_school_id() scoping and
-- Super-admin-only policies elsewhere are untouched. Idempotent: safe to
-- re-run.

-- 1. schools — supersedes db/schools_update_policy.sql's policy. One row
--    serves 4 separate settings sub-pages, each gated by its own permission,
--    so OR across all of them (plus the owner bypass already implied by
--    has_permission() short-circuiting for school_admin/super_admin, kept
--    explicit here to match the is_school_owner() convention used elsewhere).
DROP POLICY IF EXISTS "School admin updates own school" ON public.schools;
CREATE POLICY "School admin updates own school" ON public.schools
  FOR UPDATE
  USING (
    (id = public.current_school_id())
    AND (
      public.is_school_owner()
      OR public.has_permission('manage-school-profile')
      OR public.has_permission('manage-payment-config')
      OR public.has_permission('manage-discount-config')
      OR public.has_permission('manage-reminder-config')
    )
  )
  WITH CHECK (id = public.current_school_id());

-- 2. classes / sections — gated by manage-academic-structure
DROP POLICY IF EXISTS "School admin manages classes" ON public.classes;
CREATE POLICY "School admin manages classes" ON public.classes
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-academic-structure'))
  );

DROP POLICY IF EXISTS "School admin manages sections" ON public.sections;
CREATE POLICY "School admin manages sections" ON public.sections
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-academic-structure'))
  );

-- 3. billing_cycles / fee_items — gated by manage-fee-structure
DROP POLICY IF EXISTS "School admin manages cycles" ON public.billing_cycles;
CREATE POLICY "School admin manages cycles" ON public.billing_cycles
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-fee-structure'))
  );

DROP POLICY IF EXISTS "School admin manages fee items" ON public.fee_items;
CREATE POLICY "School admin manages fee items" ON public.fee_items
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-fee-structure'))
  );

-- 4. discounts (approve/reject) — gated by approve-discounts
DROP POLICY IF EXISTS "School admin approves discounts" ON public.discounts;
CREATE POLICY "School admin approves discounts" ON public.discounts
  FOR UPDATE
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('approve-discounts'))
  );

-- 5. rollover_runs / rollover_promotions — gated by run-year-end
DROP POLICY IF EXISTS "School admin manages rollover runs" ON public.rollover_runs;
CREATE POLICY "School admin manages rollover runs" ON public.rollover_runs
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('run-year-end'))
  );

DROP POLICY IF EXISTS "School admin manages rollover promotions" ON public.rollover_promotions;
CREATE POLICY "School admin manages rollover promotions" ON public.rollover_promotions
  USING (
    (EXISTS (
      SELECT 1 FROM public.rollover_runs
      WHERE rollover_runs.id = rollover_promotions.run_id
        AND rollover_runs.school_id = public.current_school_id()
    ))
    AND (public.is_school_owner() OR public.has_permission('run-year-end'))
  );

-- 6. payments — UPDATE policy narrowed to manage-fee-structure (was
--    school_admin-only), plus a new DELETE policy that never existed:
--    deleteTermDraft() (fees/cycles/actions.ts) deletes payment rows for a
--    draft term and is gated by getContext()'s default permission,
--    manage-fee-structure — with no matching DELETE policy this silently
--    deleted zero rows.
DROP POLICY IF EXISTS "School admin updates payments" ON public.payments;
CREATE POLICY "School admin updates payments" ON public.payments
  FOR UPDATE
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-fee-structure'))
  );

DROP POLICY IF EXISTS "Manage-fee-structure deletes payments" ON public.payments;
CREATE POLICY "Manage-fee-structure deletes payments" ON public.payments
  FOR DELETE
  USING (
    school_id = public.current_school_id()
    AND (public.is_school_owner() OR public.has_permission('manage-fee-structure'))
  );
