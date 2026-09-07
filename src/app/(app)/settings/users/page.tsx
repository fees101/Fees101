import { redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import UsersManager from '@/components/settings/UsersManager'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

export const dynamic = 'force-dynamic'

export default async function UsersSettingsPage() {
  const ctx = await getAuthContext()
  if (!can(ctx, 'manage-team')) redirect('/settings')
  const { supabase, schoolId, userId } = ctx!

  const [{ data: staff }, { data: roles }] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, email, role, role_id, is_active, roles(name, is_admin)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: true }),
    supabase
      .from('roles')
      .select('id, name, is_admin, permissions')
      .eq('school_id', schoolId)
      .order('name'),
  ])

  // "Last signed in" is read live from Supabase Auth (auth.users.last_sign_in_at)
  // — the always-accurate source. We deliberately don't maintain our own
  // public.users.last_login_at column (nothing reliably writes it, so it read as
  // "Never signed in" for everyone). One admin lookup per staff member; a
  // school's staff list is small, so this stays cheap.
  const admin = createServiceRoleClient()
  const lastSignInById = new Map<string, string | null>()
  await Promise.all(
    (staff || []).map(async (u: any) => {
      try {
        const { data } = await admin.auth.admin.getUserById(u.id)
        lastSignInById.set(u.id, data?.user?.last_sign_in_at ?? null)
      } catch {
        lastSignInById.set(u.id, null)
      }
    }),
  )

  const staffRows = (staff || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    baseRole: u.role,
    roleId: u.role_id,
    roleName: u.roles?.name || (u.role === 'school_admin' || u.role === 'super_admin' ? 'Administrator' : '—'),
    isAdmin: u.role === 'school_admin' || u.role === 'super_admin' || u.roles?.is_admin === true,
    isActive: u.is_active,
    lastLoginAt: lastSignInById.get(u.id) ?? null,
    isSelf: u.id === userId,
  }))

  // Mirrors the "cap delegation" rule enforced in addStaff/updateStaffRole:
  // a non-owner never even sees a role they couldn't actually assign — an
  // is_admin role, or one carrying a permission they don't personally hold.
  const assignableRoles = ctx!.isOwner
    ? (roles || [])
    : (roles || []).filter((r: any) => {
        if (r.is_admin) return false
        const rolePerms = (r.permissions as Record<string, boolean> | null) || {}
        return Object.entries(rolePerms).every(([key, on]) => !on || ctx!.permissions.has(key))
      })

  const roleOptions = assignableRoles.map((r: any) => ({ id: r.id, name: r.name, isAdmin: r.is_admin }))

  return (
    <SettingsPageShell title="Users" subtitle="People who can access this account">
      <UsersManager staff={staffRows} roles={roleOptions} isOwner={ctx!.isOwner} />
    </SettingsPageShell>
  )
}
