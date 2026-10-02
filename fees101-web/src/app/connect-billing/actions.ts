'use server'

import { headers } from 'next/headers'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { initializeMandateSetup } from '@/lib/platformBilling/paystack'
import { setupFeeNaira, BILLING_TERMS_VERSION } from '@/lib/platformBilling/config'

// Start connecting a school's billing: record the clickwrap terms acceptance,
// kick off the Paystack setup-fee transaction (which doubles as mandate
// creation), and hand back the hosted-checkout URL for the client to redirect
// to. Only the owner can do this — a bursar who lands on /connect-billing is
// shown a "ask your administrator" message instead of this button.

async function getOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

export async function startBillingConnection(
  termsAccepted: boolean,
): Promise<{ error: string } | { url: string }> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated.' }
  if (!ctx.isOwner) {
    return { error: 'Only the school owner can set up billing. Ask them to sign in and connect it.' }
  }
  if (!termsAccepted) {
    return { error: 'Please accept the billing terms to continue.' }
  }

  const svc = createServiceRoleClient()

  // The owner's email is the billing contact and the email the mandate is
  // charged against (Paystack requires the matching email on every debit).
  const { data: owner } = await svc
    .from('users')
    .select('email')
    .eq('id', ctx.userId)
    .maybeSingle()
  if (!owner?.email) return { error: 'No billing email on file for your account.' }

  // Guard against re-connecting an already-connected school (e.g. owner hits
  // the URL directly after setup). The gate normally keeps them out, but be safe.
  const { data: existing } = await svc
    .from('platform_billing')
    .select('billing_connected_at')
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (existing?.billing_connected_at) {
    return { error: 'Billing is already connected for this school.' }
  }

  const amount = setupFeeNaira()
  const reference = `setup_${ctx.schoolId}_${Date.now()}`
  const callbackUrl = `${await getOrigin()}/connect-billing/callback`

  let init
  try {
    init = await initializeMandateSetup({
      email: owner.email,
      amountNaira: amount,
      reference,
      callbackUrl,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not start billing setup. Try again.'
    return { error: msg }
  }

  // Record terms acceptance + the pending setup charge now. Upsert because a
  // freshly onboarded school may not have a platform_billing row yet.
  const now = new Date().toISOString()
  const { error: upsertError } = await svc.from('platform_billing').upsert(
    {
      school_id: ctx.schoolId,
      setup_fee_amount: amount,
      setup_fee_status: 'pending',
      setup_fee_reference: reference,
      mandate_email: owner.email,
      terms_accepted_at: now,
      terms_accepted_by: ctx.userId,
      terms_version: BILLING_TERMS_VERSION,
      updated_at: now,
    },
    { onConflict: 'school_id' },
  )
  if (upsertError) {
    return { error: 'Could not save billing details. Try again.' }
  }

  return { url: init.authorization_url }
}
