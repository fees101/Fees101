'use server'

import { headers } from 'next/headers'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { provisionPlatformDva, initializeMandateSetup } from '@/lib/platformBilling/paystack'
import { mandateSwitchChargeNaira } from '@/lib/platformBilling/config'
import { RETRY_CAP_DAYS } from '@/lib/platformBilling/recurringDebit'

async function getOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

// A suspended school's way back in: transfer the outstanding balance into a
// Fees101-owned DVA. Works the same whether the school's normal method is
// mandate (its debit kept failing) or dva (it missed a transfer) — the
// platform webhook credits whichever periods are open and reactivates
// billing on receipt, regardless of billing_method. This does not change the
// school's billing_method; it only gives a suspended school a way to pay now.
export async function getSuspensionPaymentInfo(): Promise<
  | { error: string }
  | {
      accountNumber: string
      bankName: string
      outstanding: number
      billingMethod: 'mandate' | 'dva'
      retriesExhausted: boolean
    }
> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated.' }
  if (!ctx.isOwner) return { error: 'Only the school owner can settle billing.' }

  const svc = createServiceRoleClient()
  const [{ data: billing }, { data: owner }, { data: school }, { data: periods }] = await Promise.all([
    svc
      .from('platform_billing')
      .select(
        'billing_status, billing_method, mandate_email, next_charge_due_at, platform_dva_reference, platform_dva_account_number, platform_dva_bank_name',
      )
      .eq('school_id', ctx.schoolId)
      .maybeSingle(),
    svc.from('users').select('email').eq('id', ctx.userId).maybeSingle(),
    svc.from('schools').select('name').eq('id', ctx.schoolId).maybeSingle(),
    svc
      .from('platform_billing_periods')
      .select('amount_due, amount_paid')
      .eq('school_id', ctx.schoolId)
      .in('status', ['open', 'billed', 'partial', 'overdue']),
  ])

  if (!billing || billing.billing_status !== 'suspended') return { error: 'Billing is not suspended.' }

  const outstanding = (periods || []).reduce(
    (sum, p) => sum + Math.max(Number(p.amount_due) - Number(p.amount_paid), 0),
    0,
  )
  const billingMethod = billing.billing_method === 'dva' ? 'dva' : 'mandate'
  const daysOverdue = billing.next_charge_due_at
    ? (Date.now() - new Date(billing.next_charge_due_at).getTime()) / 86_400_000
    : 0
  const retriesExhausted = billingMethod === 'mandate' && daysOverdue > RETRY_CAP_DAYS

  if (billing.platform_dva_account_number) {
    return { accountNumber: billing.platform_dva_account_number, bankName: billing.platform_dva_bank_name || '', outstanding, billingMethod, retriesExhausted }
  }

  const email = billing.mandate_email || owner?.email
  if (!email) return { error: 'No billing email on file for your account.' }

  let dva
  try {
    dva = await provisionPlatformDva({ schoolId: ctx.schoolId, schoolName: school?.name || 'School', email })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not set up a transfer account. Try again.'
    return { error: msg }
  }

  await svc
    .from('platform_billing')
    .update({
      platform_dva_reference: dva.reference,
      platform_dva_account_number: dva.accountNumber,
      platform_dva_bank_name: dva.bankName,
      platform_dva_bank_code: dva.bankCode,
      platform_dva_created_at: new Date().toISOString(),
    })
    .eq('school_id', ctx.schoolId)

  return { accountNumber: dva.accountNumber, bankName: dva.bankName, outstanding, billingMethod, retriesExhausted }
}

// Lets a suspended mandate school re-authorize a payment method right from
// the suspended page, instead of only waiting on the automatic retry (which
// stops on its own after RETRY_CAP_DAYS — see recurringDebit.ts). Reuses the
// same hosted-checkout + callback as the Settings "switch to mandate" flow
// (/api/platform-billing/switch-to-mandate/callback): that callback just
// records whatever authorization_code comes back, regardless of the school's
// billing_method beforehand, so it works equally for "replace a dead
// mandate" and "switch from DVA" without a second route.
export async function startMandateReconnect(): Promise<{ error: string } | { url: string }> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated.' }
  if (!ctx.isOwner) return { error: 'Only the school owner can do this.' }

  const svc = createServiceRoleClient()
  const [{ data: owner }, { data: billing }] = await Promise.all([
    svc.from('users').select('email').eq('id', ctx.userId).maybeSingle(),
    svc.from('platform_billing').select('billing_status, mandate_email').eq('school_id', ctx.schoolId).maybeSingle(),
  ])
  if (!billing || billing.billing_status !== 'suspended') return { error: 'Billing is not suspended.' }

  const email = owner?.email || billing.mandate_email
  if (!email) return { error: 'No billing email on file for your account.' }

  const amount = mandateSwitchChargeNaira()
  const reference = `mandate_switch_${ctx.schoolId}_${Date.now()}`
  const callbackUrl = `${await getOrigin()}/api/platform-billing/switch-to-mandate/callback`

  try {
    const init = await initializeMandateSetup({ email, amountNaira: amount, reference, callbackUrl })
    return { url: init.authorization_url }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not start reconnection. Try again.'
    return { error: msg }
  }
}
