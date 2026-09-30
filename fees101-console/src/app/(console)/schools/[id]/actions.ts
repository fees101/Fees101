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
