'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/permissions'
import { PERMISSION_KEYS } from '@/lib/auth/permissionCatalog'

// Role CRUD + the toggle matrix. All gated on manage-team. After any change we
// revalidate the whole app layout so affected users re-read their permissions on
// their next request (no re-login needed — permissions are read live).

function isOwner(ctx: { role: string }): boolean {
  return ctx.role === 'school_admin' || ctx.role === 'super_admin'
}

export async function createRole(name: string, description?: string) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }
  // Anyone with manage-team could otherwise build a brand-new role, grant it
  // everything, and quietly move themselves (or a second account) onto it —
  // a self-escalation path no per-role check can catch. Only the owner can
  // design roles at all.
  if (!isOwner(ctx)) return { error: 'Only the account owner can create roles.' }

  const trimmed = name.trim()
  if (!trimmed) return { error: 'A role name is required' }

  const { data: existing } = await ctx.supabase
    .from('roles')
    .select('id')
    .eq('school_id', ctx.schoolId)
    .ilike('name', trimmed)
    .maybeSingle()
  if (existing) return { error: `A role named “${trimmed}” already exists` }

  const { error } = await ctx.supabase.from('roles').insert({
    school_id: ctx.schoolId,
    name: trimmed,
    description: description?.trim() || null,
    is_system: false,
    is_admin: false,
    permissions: {},
  })
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return { success: true }
}

export async function renameRole(roleId: string, name: string, description?: string) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }
  if (!isOwner(ctx)) return { error: 'Only the account owner can rename roles.' }

  const trimmed = name.trim()
  if (!trimmed) return { error: 'A role name is required' }

  const { data: existing } = await ctx.supabase
    .from('roles')
    .select('id')
    .eq('school_id', ctx.schoolId)
    .ilike('name', trimmed)
    .neq('id', roleId)
    .maybeSingle()
  if (existing) return { error: `A role named “${trimmed}” already exists` }

  const { error } = await ctx.supabase
    .from('roles')
    .update({ name: trimmed, description: description?.trim() || null })
    .eq('id', roleId)
    .eq('school_id', ctx.schoolId)
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return { success: true }
}

export async function deleteRole(roleId: string) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }
  if (!isOwner(ctx)) return { error: 'Only the account owner can delete roles.' }

  const { data: role } = await ctx.supabase
    .from('roles')
    .select('id, is_system')
    .eq('id', roleId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!role) return { error: 'Role not found' }
  if (role.is_system) return { error: 'Built-in roles can’t be deleted.' }

  // Don't strip permissions from anyone silently — block while assigned.
  const { count } = await ctx.supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', ctx.schoolId)
    .eq('role_id', roleId)
  if ((count || 0) > 0) {
    return { error: 'This role is still assigned to staff. Reassign them to another role first.' }
  }

  const { error } = await ctx.supabase
    .from('roles')
    .delete()
    .eq('id', roleId)
    .eq('school_id', ctx.schoolId)
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return { success: true }
}

export async function saveRolePermissions(roleId: string, permissions: Record<string, boolean>) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  // Editing your own role's permissions is how a manage-team holder could
  // silently grant themselves everything else, with no reassignment and no
  // is_admin flag ever touched — same self-escalation risk updateStaffRole
  // already blocks for role reassignment.
  if (roleId === ctx.roleId) {
    return { error: 'You can’t edit the permissions of your own role. Ask another admin to do it.' }
  }
  // Editing someone else's role's permissions is just as effective a
  // self-escalation path once combined with createRole/updateStaffRole — a
  // manage-team holder could build a second, colluding staff account, then
  // grant that account's role full access without ever touching is_admin or
  // their own role. Only the owner can change what any role is allowed to do.
  if (!isOwner(ctx)) return { error: 'Only the account owner can change role permissions.' }

  const { data: role } = await ctx.supabase
    .from('roles')
    .select('id, name, is_admin, permissions')
    .eq('id', roleId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!role) return { error: 'Role not found' }
  if (role.is_admin) return { error: 'The Administrator role always has full access and can’t be edited.' }

  // Only persist known keys — ignore anything a stale client might send.
  const clean: Record<string, boolean> = {}
  for (const k of PERMISSION_KEYS) clean[k] = permissions[k] === true

  const before = (role.permissions || {}) as Record<string, boolean>
  const turnedOn = PERMISSION_KEYS.filter(k => !before[k] && clean[k])
  const turnedOff = PERMISSION_KEYS.filter(k => before[k] && !clean[k])

  const { error } = await ctx.supabase
    .from('roles')
    .update({ permissions: clean })
    .eq('id', roleId)
    .eq('school_id', ctx.schoolId)
  if (error) return { error: error.message }

  // No dedicated audit log yet — surfaced as an admin notification so a
  // permission grant on a role you don't hold yourself (the one path that
  // isn't otherwise blocked) is still visible to the owner shortly after.
  if (turnedOn.length || turnedOff.length) {
    const { data: actor } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()
    const parts: string[] = []
    if (turnedOn.length) parts.push(`turned on: ${turnedOn.join(', ')}`)
    if (turnedOff.length) parts.push(`turned off: ${turnedOff.join(', ')}`)
    await ctx.supabase.from('admin_notifications').insert({
      school_id: ctx.schoolId,
      type: 'role_permissions_changed',
      title: `Permissions changed for "${role.name}"`,
      body: `${actor?.name || 'Someone'} changed "${role.name}"'s permissions — ${parts.join('; ')}.`,
    })
  }

  revalidatePath('/', 'layout')
  return { success: true }
}
