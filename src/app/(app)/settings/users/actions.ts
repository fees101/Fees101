'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requirePermission } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { createClient } from '@supabase/supabase-js'

// Team management: add staff (Supabase-emailed set-password invite), reassign
// roles, and activate/deactivate logins. All gated on manage-team. New auth
// users are created with the service-role client (no session exists for them
// yet); role/active edits go through the RLS client, allowed by the
// "Manage-team updates school users" policy.

async function getOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

interface AddStaffInput {
  name: string
  email: string
  roleId: string
}

export async function addStaff(input: AddStaffInput) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (!name) return { error: 'Name is required' }
  if (!email || !email.includes('@')) return { error: 'A valid email is required' }
  if (!input.roleId) return { error: 'Please choose a role' }

  // The chosen role must belong to this school (RLS-scoped read).
  const { data: role } = await ctx.supabase
    .from('roles')
    .select('id, name, is_admin')
    .eq('id', input.roleId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!role) return { error: 'Role not found' }

  // Only the account owner can hand out Administrator — otherwise anyone with
  // manage-team could invite a brand-new staff account straight into it.
  if (role.is_admin && ctx.role !== 'school_admin' && ctx.role !== 'super_admin') {
    return { error: 'Only the account owner can add someone as an Administrator.' }
  }

  // Guard against a duplicate staff row in this school.
  const { data: existingInSchool } = await ctx.supabase
    .from('users')
    .select('id')
    .eq('school_id', ctx.schoolId)
    .ilike('email', email)
    .maybeSingle()
  if (existingInSchool) return { error: 'Someone with that email is already on your team.' }

  const admin = createServiceRoleClient()
  const origin = await getOrigin()

  // inviteUserByEmail() creates the auth user AND sends Supabase's own invite
  // email directly — no SES dependency, no manual link handling.
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${origin}/auth/callback?next=/set-password` },
  )

  if (inviteError || !inviteData?.user) {
    const msg = (inviteError?.message || '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return { error: 'That email already has a Fees101 login. It can only belong to one school.' }
    }
    return { error: inviteError?.message || 'Could not create the invite.' }
  }

  const newUserId = inviteData.user.id

  // Insert the public.users profile. role stays the base 'bursar' type; the
  // custom role_id carries the actual permissions.
  const { error: insertError } = await admin.from('users').insert({
    id: newUserId,
    school_id: ctx.schoolId,
    name,
    email,
    role: 'bursar',
    role_id: input.roleId,
    is_active: true,
  })
  if (insertError) {
    // Roll back the orphaned auth user so a retry can succeed cleanly.
    await admin.auth.admin.deleteUser(newUserId)
    return { error: insertError.message }
  }

  // No dedicated audit log yet — surfaced as an admin notification so a new
  // staff account (a possible sock-puppet, the one escalation path role/
  // reassignment guards can't touch) is at least visible to the owner soon
  // after it's created.
  const { data: actor } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()
  await ctx.supabase.from('admin_notifications').insert({
    school_id: ctx.schoolId,
    type: 'staff_added',
    title: `${name} added to your team`,
    body: `${actor?.name || 'Someone'} invited ${name} (${email}) with the "${role.name}" role.`,
  })

  revalidatePath('/settings/users')
  return { success: true }
}

export async function updateStaffRole(userId: string, roleId: string, reason: string) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  // Changing your own role could silently strip your own access — block it and
  // ask another admin to do it.
  if (userId === ctx.userId) {
    return { error: 'You can’t change your own role. Ask another admin to do it.' }
  }

  const trimmedReason = reason.trim()
  if (!trimmedReason) return { error: 'A reason is required to change someone’s role.' }

  const { data: targetUser } = await ctx.supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  // The account owner's role is fixed — no one, including another admin, can
  // change it through here.
  if (targetUser?.role === 'school_admin' || targetUser?.role === 'super_admin') {
    return { error: 'The account owner’s role can’t be changed.' }
  }

  const { data: role } = await ctx.supabase
    .from('roles')
    .select('id, name, is_admin')
    .eq('id', roleId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!role) return { error: 'Role not found' }

  // Only the account owner can promote someone into an Administrator role.
  if (role.is_admin && ctx.role !== 'school_admin' && ctx.role !== 'super_admin') {
    return { error: 'Only the account owner can assign the Administrator role.' }
  }

  const { data: staff } = await ctx.supabase
    .from('users')
    .select('name, roles(name)')
    .eq('id', userId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()

  const { data: actor } = await ctx.supabase
    .from('users')
    .select('name')
    .eq('id', ctx.userId)
    .maybeSingle()

  const { error } = await ctx.supabase
    .from('users')
    .update({ role_id: roleId })
    .eq('id', userId)
    .eq('school_id', ctx.schoolId)
  if (error) return { error: error.message }

  // No dedicated audit log yet (planned separately) — recorded as an in-app
  // admin notification for now so the reason isn't lost, same table used for
  // message-delivery-failure banners.
  const fromRoleName = (staff?.roles as any)?.name || 'no role'
  await ctx.supabase.from('admin_notifications').insert({
    school_id: ctx.schoolId,
    type: 'role_changed',
    title: `${staff?.name || 'A team member'}'s role changed to ${role.name}`,
    body: `${actor?.name || 'Someone'} changed ${staff?.name || 'this user'}'s role from ${fromRoleName} to ${role.name}. Reason: ${trimmedReason}`,
  })

  revalidatePath('/settings/users')
  return { success: true }
}

export async function setStaffActive(userId: string, active: boolean) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  // Can't lock yourself out.
  if (userId === ctx.userId) {
    return { error: 'You can’t deactivate your own account.' }
  }

  // The account owner can never be deactivated by anyone else, admin or not —
  // the "last active admin" check below only stops the count hitting zero,
  // which a second admin could still bypass by deactivating the real owner
  // while staying active themselves.
  const { data: targetUser } = await ctx.supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!active && (targetUser?.role === 'school_admin' || targetUser?.role === 'super_admin')) {
    return { error: 'The account owner can’t be deactivated.' }
  }

  // Don't let the school drop below one active admin. An "admin" is an owner
  // (school_admin) or anyone on an is_admin role.
  if (!active) {
    const { data: admins } = await ctx.supabase
      .from('users')
      .select('id, role, is_active, roles(is_admin)')
      .eq('school_id', ctx.schoolId)
      .eq('is_active', true)

    const activeAdmins = (admins || []).filter((u: any) =>
      u.role === 'school_admin' || u.role === 'super_admin' || u.roles?.is_admin === true,
    )
    const isTargetAdmin = activeAdmins.some((u: any) => u.id === userId)
    if (isTargetAdmin && activeAdmins.length <= 1) {
      return { error: 'This is the last active admin — assign another admin before deactivating them.' }
    }
  }

  const { error } = await ctx.supabase
    .from('users')
    .update({ is_active: active })
    .eq('id', userId)
    .eq('school_id', ctx.schoolId)
  if (error) return { error: error.message }

  revalidatePath('/settings/users')
  return { success: true }
}

export async function resetStaffPassword(userId: string) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const { data: staff } = await ctx.supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!staff?.email) return { error: 'Staff member not found' }

  const origin = await getOrigin()

  // resetPasswordForEmail() is the same self-service "forgot password" call,
  // triggered here by an admin on someone else's behalf — it sends Supabase's
  // own recovery email, no service-role key or SES dependency needed. Unlike
  // inviteUserByEmail(), it works for accounts that have already signed in.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { error: resetError } = await anon.auth.resetPasswordForEmail(staff.email, {
    redirectTo: `${origin}/auth/callback?next=/set-password`,
  })
  if (resetError) return { error: resetError.message || 'Could not send a reset link.' }

  return { success: true }
}

export async function resendInvite(userId: string) {
  const ctx = await requirePermission('manage-team')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const { data: staff } = await ctx.supabase
    .from('users')
    .select('email, role_id, roles(name)')
    .eq('id', userId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!staff?.email) return { error: 'Staff member not found' }

  const admin = createServiceRoleClient()
  const origin = await getOrigin()

  // Re-inviting an existing, still-unconfirmed user re-sends Supabase's own
  // invite email with a fresh token.
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    staff.email,
    { redirectTo: `${origin}/auth/callback?next=/set-password` },
  )
  if (inviteError) {
    return { error: inviteError.message || 'Could not send a new invite.' }
  }

  revalidatePath('/settings/users')
  return { success: true }
}
