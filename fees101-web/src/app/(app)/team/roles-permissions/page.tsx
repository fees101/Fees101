import { redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import RolesEditor from '@/components/settings/RolesEditor'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { PERMISSIONS } from '@/lib/auth/permissionCatalog'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Roles & permissions' }

export const dynamic = 'force-dynamic'

export default async function RolesPermissionsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-team')) {
    return (
      <SettingsPageShell workspaceKey="team" title="Roles & permissions">
        <AccessDenied ctx={ctx} permissionKey="manage-team" padded={false} />
      </SettingsPageShell>
    )
  }
  const { supabase, schoolId, roleId: ownRoleId, role } = ctx
  const isOwner = role === 'school_admin' || role === 'super_admin'

  // Roles and the per-role staff counts are independent — fetch together.
  const [{ data: roles }, { data: staff }] = await Promise.all([
    supabase
      .from('roles')
      .select('id, name, description, is_system, is_admin, permissions')
      .eq('school_id', schoolId)
      .order('is_admin', { ascending: false })
      .order('is_system', { ascending: false })
      .order('name'),
    // How many staff are on each role (for the "assigned" count + delete guard UX).
    supabase
      .from('users')
      .select('role_id')
      .eq('school_id', schoolId),
  ])

  const counts: Record<string, number> = {}
  for (const s of staff || []) {
    if ((s as any).role_id) counts[(s as any).role_id] = (counts[(s as any).role_id] || 0) + 1
  }

  const roleRows = (roles || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    isAdmin: r.is_admin,
    permissions: (r.permissions || {}) as Record<string, boolean>,
    assignedCount: counts[r.id] || 0,
  }))

  return (
    <SettingsPageShell workspaceKey="team" title="Roles & permissions">
      {schoolId && (
        // Another admin editing roles or reassigning staff (staff counts).
        <RealtimeRefresh
          subscriptions={[
            { table: 'roles', filter: `school_id=eq.${schoolId}` },
            { table: 'users', filter: `school_id=eq.${schoolId}` },
          ]}
        />
      )}
      <RolesEditor roles={roleRows} catalog={PERMISSIONS} ownRoleId={ownRoleId} isOwner={isOwner} />
    </SettingsPageShell>
  )
}
