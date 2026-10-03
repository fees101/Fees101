'use server'

import { headers } from 'next/headers'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import {
  initializeMandateSetup,
  provisionPlatformDva,
  deactivateMandate,
} from '@/lib/platformBilling/paystack'
import { mandateSwitchChargeNaira } from '@/lib/platformBilling/config'
import { logAuditEvent } from '@/lib/audit/logAudit'

// Lets an already-connected school flip its collection method
// (platform_billing.billing_method) back and forth. Unlike /connect-billing's
// actions, these never touch billing_connected_at or the setup fee — the
// school already paid to get in; this only changes how the monthly fee is
// collected going forward.

async function getOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

// Start the hosted Paystack checkout that re-establishes a direct-debit
// mandate for a school currently on DVA. The reference is namespaced with the
// school id and checked against ctx.schoolId (the authenticated session) at
// the callback rather than stored in a new column — this table has one row
// per school, so there is nothing to disambiguate beyond "is this my school's
// reference", which the prefix already proves.
export async function startSwitchToMandate(): Promise<{ error: string } | { url: string }> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated.' }
  if (!ctx.isOwner) {
    return { error: 'Only the school owner can change how billing is collected.' }
  }

  const svc = createServiceRoleClient()

  const [{ data: owner }, { data: billing }] = await Promise.all([
    svc.from('users').select('email').eq('id', ctx.userId).maybeSingle(),
    svc
      .from('platform_billing')
      .select('billing_connected_at, billing_method, mandate_email')
      .eq('school_id', ctx.schoolId)
      .maybeSingle(),
  ])
  if (!billing?.billing_connected_at) return { error: 'Billing is not connected yet.' }
  if (billing.billing_method !== 'dva') return { error: 'Already collecting by direct debit.' }

  const email = owner?.email || billing.mandate_email
  if (!email) return { error: 'No billing email on file for your account.' }

  const amount = mandateSwitchChargeNaira()
  const reference = `mandate_switch_${ctx.schoolId}_${Date.now()}`
  const callbackUrl = `${await getOrigin()}/api/platform-billing/switch-to-mandate/callback`

  let init
  try {
    init = await initializeMandateSetup({ email, amountNaira: amount, reference, callbackUrl })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not start the switch. Try again.'
    return { error: msg }
  }

  return { url: init.authorization_url }
}

// Switch a school currently on a mandate to bank transfer (DVA). Synchronous,
// same shape as connect-billing's startDvaFallback: provision (or reuse) the
// DVA, then flip billing_method. The old mandate is deactivated on Paystack so
// it can't still be debited after the switch.
export async function switchToDva(): Promise<
  { error: string } | { accountNumber: string; bankName: string }
> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated.' }
  if (!ctx.isOwner) {
    return { error: 'Only the school owner can change how billing is collected.' }
  }

  const svc = createServiceRoleClient()

  const [{ data: owner }, { data: school }, { data: billing }] = await Promise.all([
    svc.from('users').select('email').eq('id', ctx.userId).maybeSingle(),
    svc.from('schools').select('name').eq('id', ctx.schoolId).maybeSingle(),
    svc
      .from('platform_billing')
      .select(
        'billing_connected_at, billing_method, mandate_authorization_code, mandate_email, platform_dva_account_number, platform_dva_bank_name',
      )
      .eq('school_id', ctx.schoolId)
      .maybeSingle(),
  ])
  if (!billing?.billing_connected_at) return { error: 'Billing is not connected yet.' }
  if (billing.billing_method !== 'mandate') return { error: 'Already collecting by bank transfer.' }

  const email = owner?.email || billing.mandate_email
  if (!email) return { error: 'No billing email on file for your account.' }

  // Reuse an existing DVA rather than minting a second one (e.g. a prior
  // switch back to mandate and now back to DVA again).
  let accountNumber = billing.platform_dva_account_number
  let bankName = billing.platform_dva_bank_name

  if (!accountNumber) {
    try {
      const dva = await provisionPlatformDva({ schoolId: ctx.schoolId, schoolName: school?.name || 'School', email })
      accountNumber = dva.accountNumber
      bankName = dva.bankName
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not set up bank transfer. Try again.'
      return { error: msg }
    }
  }

  // Best-effort: stop the mandate from being charged going forward. Not fatal
  // if Paystack has already deactivated it on their side.
  if (billing.mandate_authorization_code) {
    try {
      await deactivateMandate(billing.mandate_authorization_code)
    } catch {
      // ignore — mandate_status/billing_method below is what actually stops future debits
    }
  }

  const now = new Date().toISOString()
  const { error: updateError } = await svc
    .from('platform_billing')
    .update({
      billing_method: 'dva',
      mandate_status: 'revoked',
      mandate_deactivated_at: now,
      updated_at: now,
    })
    .eq('school_id', ctx.schoolId)
  if (updateError) return { error: 'Could not save billing details. Try again.' }

  await logAuditEvent(svc, {
    schoolId: ctx.schoolId,
    actorId: ctx.userId,
    action: 'platform_billing.method_changed',
    summary: 'Switched platform billing to bank transfer',
  })

  return { accountNumber: accountNumber!, bankName: bankName || '' }
}
