import { redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import UsersManager from '@/components/settings/UsersManager'
import { getAuthContext, can } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function UsersSettingsPage() {
  const ctx = await getAuthContext()
  if (!can(ctx, 'manage-team')) redirect('/settings')
  const { supabase, schoolId, userId } = ctx!

  const [{ data: staff }, { data: roles }] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, email, role, role_id, is_active, last_login_at, roles(name, is_admin)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: true }),
    supabase
      .from('roles')
      .select('id, name, is_admin')
      .eq('school_id', schoolId)
      .order('name'),
  ])

  const staffRows = (staff || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    baseRole: u.role,
    roleId: u.role_id,
    roleName: u.roles?.name || (u.role === 'school_admin' || u.role === 'super_admin' ? 'Administrator' : '—'),
    isAdmin: u.role === 'school_admin' || u.role === 'super_admin' || u.roles?.is_admin === true,
    isActive: u.is_active,
    lastLoginAt: u.last_login_at,
    isSelf: u.id === userId,
  }))

  const roleOptions = (roles || []).map((r: any) => ({ id: r.id, name: r.name, isAdmin: r.is_admin }))

  return (
    <SettingsPageShell title="Users" subtitle="People who can access this account">
      <UsersManager staff={staffRows} roles={roleOptions} />
    </SettingsPageShell>
  )
}
