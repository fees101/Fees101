'use server'

import { revalidatePath } from 'next/cache'
import { getPlatformAdmin } from '@/lib/auth'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { initializeCardCapture } from '@/lib/paystack'
import { chargeSchoolForTerm, evaluateSuspensionLadder } from '@/lib/billing'

async function requireAdmin() {
  const admin = await getPlatformAdmin()
  if (!admin) throw new Error('Not authenticated')
  return admin
}

export async function setAnnualPrice(schoolId: string, annualPrice: number) {
  const admin = await requireAdmin()
  const supabase = createServiceRoleClient()

  await supabase
    .from('platform_billing')
    .upsert({ school_id: schoolId, annual_price: annualPrice, updated_at: new Date().toISOString() }, { onConflict: 'school_id' })

  await supabase.from('platform_audit_log').insert({
    actor_id: admin.id,
    actor_name: admin.name,
    action: 'billing.price_set',
    school_id: schoolId,
    summary: `Set annual price to ₦${annualPrice.toLocaleString()}`,
    metadata: { annualPrice },
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

export async function chargeNow(schoolId: string) {
  const admin = await requireAdmin()
  const result = await chargeSchoolForTerm(schoolId, admin.name)
  revalidatePath(`/schools/${schoolId}`)
  return result
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
