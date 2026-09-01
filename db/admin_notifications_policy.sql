-- admin_notifications has RLS enabled but no CREATE POLICY exists anywhere
-- in fees101_schema.sql or db/ — yet the app inserts (adminNotify.ts,
-- roles-permissions/actions.ts, settings/users/actions.ts) and updates/
-- dismisses (notifications-actions.ts: dismissAdminNotification) this table
-- through the RLS-scoped user client. Either this has been a silent no-op
-- all along (dismissing a notification doesn't actually persist) or a
-- policy exists live but was never committed — this file is correct either
-- way (DROP POLICY IF EXISTS first).
--
-- No specific permission gates access today (any authenticated staff member
-- of the school can see/dismiss notifications, and the few insert call
-- sites are already gated upstream by their own action's permission check,
-- e.g. manage-team for staff-related notifications) — so scope is simply
-- same-school membership, matching the code's current behavior.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff see own school notifications" ON public.admin_notifications;
CREATE POLICY "Staff see own school notifications" ON public.admin_notifications
  FOR SELECT
  USING (school_id = public.current_school_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Staff insert own school notifications" ON public.admin_notifications;
CREATE POLICY "Staff insert own school notifications" ON public.admin_notifications
  FOR INSERT
  WITH CHECK (school_id = public.current_school_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Staff dismiss own school notifications" ON public.admin_notifications;
CREATE POLICY "Staff dismiss own school notifications" ON public.admin_notifications
  FOR UPDATE
  USING (school_id = public.current_school_id() OR public.is_super_admin())
  WITH CHECK (school_id = public.current_school_id() OR public.is_super_admin());
