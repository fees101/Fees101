'use server'

import { revalidatePath } from 'next/cache'
import { getPlatformAdmin } from '@/lib/auth'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { initializeCardCapture, deactivateMandate } from '@/lib/paystack'
import { evaluateSuspensionLadder } from '@/lib/billing'

async function requireAdmin() {
  const admin = await getPlatformAdmin()
  if (!admin) throw new Error('Not authenticated')
  return admin
}

// Per-student monthly price for the real billing model (daily pro-rata
// accrual — see src/lib/accrual.ts). Overrides the DB default of 500 for
// this school only. Validates the value is a positive number, since 0 or
// negative would silently zero out accrual.
export async function setPricePerStudentMonth(schoolId: string, pricePerStudentMonth: number) {
  if (!Number.isFinite(pricePerStudentMonth) || pricePerStudentMonth <= 0) {
    throw new Error('Price per student must be a positive number.')
  }

  const admin = await requireAdmin()
  const supabase = createServiceRoleClient()

  await supabase
    .from('platform_billing')
    .upsert({ school_id: schoolId, price_per_student_month: pricePerStudentMonth, updated_at: new Date().toISOString() }, { onConflict: 'school_id' })

  await supabase.from('platform_audit_log').insert({
    actor_id: admin.id,
    actor_name: admin.name,
    action: 'billing.price_per_student_set',
    school_id: schoolId,
    summary: `Set price per student to ₦${pricePerStudentMonth.toLocaleString()}/month`,
    metadata: { pricePerStudentMonth },
  })

  revalidatePath(`/schools/${schoolId}`)
}

// Kicks off card capture — returns the Paystack hosted-checkout URL to send
// the admin to. Uses this dashboard's own email as the Paystack customer
// email unless the school has one on file, since it's the platform's card
// being captured for platform billing, not a parent-facing flow.
export async function startCardCapture(schoolId: string, billingEmail: string) {
  await requireAdmin()
  const reference = `capture_${schoolId}_${Date.now()}`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3100'

  const { authorization_url } = await initializeCardCapture({
    email: billingEmail,
    reference,
    callbackUrl: `${appUrl}/api/paystack/callback?school_id=${schoolId}`,
  })

  return { url: authorization_url }
}

export async function runSuspensionCheck(schoolId: string) {
  await requireAdmin()
  const result = await evaluateSuspensionLadder(schoolId)
  revalidatePath(`/schools/${schoolId}`)
  return result
}

type RegenerateLinkResult =
  | { error: string }
  | { alreadyActive: true; email: string }
  | { success: true; email: string; actionLink: string }

// Regenerates the owner's activation link when the first one expired or was
// never used. Supabase invite tokens are single-use and time-limited, so an
// unused/expired link can't be revived — only a fresh one issued. If the owner
// has already activated (set a password), there's nothing to regenerate: they
// log in normally, or use password reset. generateLink(type:'invite') would
// itself error for a confirmed user, so we check activation first and give a
// clear message instead of surfacing a raw Supabase error.
export async function regenerateOwnerLink(schoolId: string): Promise<RegenerateLinkResult> {
  const admin = await requireAdmin()
  const supabase = createServiceRoleClient()

  const { data: owner } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('school_id', schoolId)
    .eq('role', 'school_admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!owner?.email) return { error: 'No owner account found for this school.' }

  const { data: authUser } = await supabase.auth.admin.getUserById(owner.id)
  if (authUser?.user?.email_confirmed_at || authUser?.user?.last_sign_in_at) {
    return { alreadyActive: true, email: owner.email }
  }

  const { data: school } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle()
  const schoolAppUrl = process.env.SCHOOL_APP_URL || 'http://localhost:3000'
  const redirectTo = `${schoolAppUrl}/auth/callback?next=${encodeURIComponent(`/set-password?email=${encodeURIComponent(owner.email)}`)}`

  const { data: inviteData, error: inviteError } = await supabase.auth.admin.generateLink({
    type: 'invite',
    email: owner.email,
    options: {
      redirectTo,
      data: { name: owner.name || '', school_name: school?.name || '', role_name: 'Administrator', inviter_name: admin.name },
    },
  })

  if (inviteError || !inviteData?.properties?.action_link) {
    return { error: inviteError?.message || 'Could not generate a new link.' }
  }

  await supabase.from('platform_audit_log').insert({
    actor_id: admin.id,
    actor_name: admin.name,
    action: 'school.owner_link_regenerated',
    school_id: schoolId,
    summary: `Regenerated the activation link for owner ${owner.name || owner.email}`,
    metadata: { ownerEmail: owner.email },
  })

  return { success: true, email: owner.email, actionLink: inviteData.properties.action_link }
}

type PasswordResetResult = { error: string } | { success: true; email: string; actionLink: string }

// Issues a password-reset link for an owner who already activated and is
// locked out — typically because they called in asking for one. Unlike
// regenerateOwnerLink (which only applies before activation), this works on
// any owner account regardless of activation state. The requester's note is
// required so there's a record of who asked for it, since this is otherwise
// an unprompted credential action taken on someone else's account. Logged to
// platform_audit_log only — nothing here changes the owner's password
// directly, Supabase's recovery flow does that once they click the link, so
// there's no state change for the school's own audit log to reflect.
export async function sendOwnerPasswordReset(schoolId: string, requestedBy: string): Promise<PasswordResetResult> {
  const admin = await requireAdmin()
  const note = requestedBy.trim()
  if (!note) return { error: 'Note who requested this before sending the link.' }

  const supabase = createServiceRoleClient()

  const { data: owner } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('school_id', schoolId)
    .eq('role', 'school_admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!owner?.email) return { error: 'No owner account found for this school.' }

  const schoolAppUrl = process.env.SCHOOL_APP_URL || 'http://localhost:3000'
  const redirectTo = `${schoolAppUrl}/auth/callback?next=${encodeURIComponent(`/set-password?email=${encodeURIComponent(owner.email)}`)}`

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: owner.email,
    options: { redirectTo },
  })

  if (linkError || !linkData?.properties?.action_link) {
    return { error: linkError?.message || 'Could not generate a reset link.' }
  }

  await supabase.from('platform_audit_log').insert({
    actor_id: admin.id,
    actor_name: admin.name,
    action: 'school.owner_password_reset_sent',
    school_id: schoolId,
    summary: `Sent a password reset link for owner ${owner.name || owner.email}`,
    metadata: { ownerEmail: owner.email, requestedBy: note },
  })

  return { success: true, email: owner.email, actionLink: linkData.properties.action_link }
}

// Founder-initiated hard stop for a school's direct-debit mandate — for when
// a school leaves or closes its account and billing should not wait on the
// recurring-debit cron to notice. Deactivates the authorization at Paystack
// first so it immediately can't be charged, then marks it cancelled locally.
export async function deactivateSchoolMandate(schoolId: string) {
  const admin = await requireAdmin()
  const supabase = createServiceRoleClient()

  const { data: billing } = await supabase
    .from('platform_billing')
    .select('mandate_authorization_code, mandate_status')
    .eq('school_id', schoolId)
    .maybeSingle()

  if (!billing?.mandate_authorization_code) {
    throw new Error('No mandate authorization on file for this school.')
  }
  if (billing.mandate_status === 'cancelled' || billing.mandate_status === 'revoked') {
    throw new Error('Mandate is already deactivated.')
  }

  await deactivateMandate(billing.mandate_authorization_code)

  const nowIso = new Date().toISOString()
  await supabase
    .from('platform_billing')
    .update({ mandate_status: 'cancelled', mandate_deactivated_at: nowIso })
    .eq('school_id', schoolId)

  await supabase.from('platform_audit_log').insert({
    actor_id: admin.id,
    actor_name: admin.name,
    action: 'billing.mandate_deactivated',
    school_id: schoolId,
    summary: 'Deactivated the direct-debit mandate',
    metadata: { previousStatus: billing.mandate_status },
  })

  revalidatePath(`/schools/${schoolId}`)
}

type StartImpersonationResult =
  | { error: string }
  | { success: true; actionLink: string }

// Founder/platform-admin "View as this school (read-only)" — resolves the
// target school's owner exactly like regenerateOwnerLink() does, opens an
// impersonation_sessions row (picked up by fees101-web's current_school_id()
// and loadAuthContext()), and issues a magic link for the PLATFORM ADMIN'S
// OWN email so the resulting fees101-web session is genuinely the admin's own
// identity — not the assumed user's. Read-only enforcement happens entirely
// on the fees101-web side (can()); this action only opens the session.
export async function startImpersonation(schoolId: string): Promise<StartImpersonationResult> {
  const admin = await requireAdmin()
  const supabase = createServiceRoleClient()

  const { data: owner } = await supabase
    .from('users')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('role', 'school_admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!owner) return { error: 'No owner account found for this school.' }

  const { data: school } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle()
  if (!school) return { error: 'School not found.' }

  const expiresAt = new Date(Date.now() + 20 * 60 * 1000)

  const { data: session, error: insertError } = await supabase
    .from('impersonation_sessions')
    .insert({
      platform_admin_id: admin.id,
      platform_admin_name: admin.name,
      platform_admin_email: admin.email,
      target_school_id: schoolId,
      target_school_name: school.name,
      target_user_id: owner.id,
      target_user_name: owner.name,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single()

  if (insertError || !session) {
    return { error: insertError?.message || 'Could not start the impersonation session.' }
  }

  await supabase.from('platform_audit_log').insert({
    actor_id: admin.id,
    actor_name: admin.name,
    action: 'impersonation.started',
    school_id: schoolId,
    summary: `Started viewing ${school.name} as ${owner.name || 'the owner'} (read-only)`,
    metadata: { impersonationSessionId: session.id, targetUserId: owner.id, expiresAt: expiresAt.toISOString() },
  })

  const schoolAppUrl = process.env.SCHOOL_APP_URL || 'http://localhost:3000'
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: admin.email,
    options: {
      redirectTo: `${schoolAppUrl}/auth/callback?next=${encodeURIComponent('/today')}`,
    },
  })

  if (linkError || !linkData?.properties?.action_link) {
    return { error: linkError?.message || 'Could not generate the sign-in link.' }
  }

  return { success: true, actionLink: linkData.properties.action_link }
}

export async function setBillingStatusManually(schoolId: string, status: string) {
  const admin = await requireAdmin()
  const supabase = createServiceRoleClient()

  await supabase
    .from('platform_billing')
    .update({ billing_status: status, billing_status_changed_at: new Date().toISOString() })
    .eq('school_id', schoolId)

  await supabase.from('platform_audit_log').insert({
    actor_id: admin.id,
    actor_name: admin.name,
    action: 'billing.status_set_manually',
    school_id: schoolId,
    summary: `Manually set billing status to ${status}`,
    metadata: { status },
  })

  revalidatePath(`/schools/${schoolId}`)
}
