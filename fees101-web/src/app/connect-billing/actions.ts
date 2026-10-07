'use server'

import { headers } from 'next/headers'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { initializeMandateSetup, provisionPlatformDva } from '@/lib/platformBilling/paystack'
import { setupFeeNaira, BILLING_TERMS_VERSION, MANDATE_SOFT_FAIL_THRESHOLD, SUPPORT_EMAIL } from '@/lib/platformBilling/config'

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
): Promise<{ error: string } | { url: string } | { redirect: string }> {
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

  // Already connected (e.g. the state flipped while this tab was open, or a
  // stale/bookmarked load). Don't strand them with an error on this page — just
  // send them into the app, the same place the page-load redirect would.
  const { data: existing } = await svc
    .from('platform_billing')
    .select('billing_connected_at, mandate_attempt_count')
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (existing?.billing_connected_at) {
    return { redirect: '/today' }
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
  // freshly onboarded school may not have a platform_billing row yet. Count this
  // attempt: the callback (transient-failure threshold) and the connect screen
  // read mandate_attempt_count to decide when the transfer fallback auto-opens.
  const now = new Date().toISOString()
  const { error: upsertError } = await svc.from('platform_billing').upsert(
    {
      school_id: ctx.schoolId,
      setup_fee_amount: amount,
      setup_fee_status: 'pending',
      setup_fee_reference: reference,
      mandate_email: owner.email,
      mandate_attempt_count: (existing?.mandate_attempt_count ?? 0) + 1,
      mandate_last_attempt_at: now,
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

// Fallback for a school whose bank isn't on Paystack's direct-debit list, or
// whose mandate checkout failed: provision a Fees101-owned DVA and show them
// an account number to transfer the setup fee into instead. The transfer
// lands via the platform webhook (fees101-console's /api/paystack/webhook ->
// reconcilePlatformTransfer), which sets billing_connected_at once a transfer
// of at least the setup fee amount arrives — this action only gets them the
// account details, it never unlocks the gate itself.
export async function startDvaFallback(
  termsAccepted: boolean,
): Promise<{ error: string } | { accountNumber: string; bankName: string; amount: number } | { redirect: string }> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated.' }
  if (!ctx.isOwner) {
    return { error: 'Only the school owner can set up billing. Ask them to sign in and connect it.' }
  }
  if (!termsAccepted) {
    return { error: 'Please accept the billing terms to continue.' }
  }

  const svc = createServiceRoleClient()

  const [{ data: owner }, { data: school }, { data: existing }] = await Promise.all([
    svc.from('users').select('email').eq('id', ctx.userId).maybeSingle(),
    svc.from('schools').select('name').eq('id', ctx.schoolId).maybeSingle(),
    svc
      .from('platform_billing')
      .select('billing_connected_at, platform_dva_account_number, platform_dva_bank_name, dva_fallback_enabled, mandate_attempt_count')
      .eq('school_id', ctx.schoolId)
      .maybeSingle(),
  ])
  if (!owner?.email) return { error: 'No billing email on file for your account.' }
  if (existing?.billing_connected_at) return { redirect: '/today' }

  // H1 / smart fallback — the school can't casually opt off the auto-debit mandate
  // (the retention lock; it keeps people from taking 65 free days + easy transfer
  // and never committing). It unlocks the bank-transfer fallback only when the
  // mandate genuinely isn't working, in one of three ways:
  //   1. Fees101 enabled DVA for this school from the console (dva_fallback_enabled)
  //      — the hand-holding path for the first schools, or a support request.
  //   2. The callback SMART-enabled it after a hard failure (bank unsupported /
  //      abandoned) — that also sets dva_fallback_enabled.
  //   3. The owner has hit the transient-failure threshold (declined/timeout a few
  //      times): mandate_attempt_count >= MANDATE_SOFT_FAIL_THRESHOLD. This covers
  //      a pure abandon that never returned to the callback (so the flag was never
  //      set) — after enough tries the transfer opens anyway.
  // Enforced here, not just hidden in the UI, so a direct call can't bypass it.
  const attemptCount = existing?.mandate_attempt_count ?? 0
  const selfServeAllowed =
    existing?.dva_fallback_enabled === true || attemptCount >= MANDATE_SOFT_FAIL_THRESHOLD
  if (!selfServeAllowed) {
    return {
      error:
        `Please try automatic bank debit first. If it keeps failing or your bank isn’t supported, the option to pay by bank transfer opens here automatically — or email ${SUPPORT_EMAIL} and we’ll switch you over.`,
    }
  }

  const amount = setupFeeNaira()

  // Already provisioned (e.g. page refresh) — hand back the same account
  // rather than minting a second one.
  if (existing?.platform_dva_account_number) {
    return { accountNumber: existing.platform_dva_account_number, bankName: existing.platform_dva_bank_name || '', amount }
  }

  let dva
  try {
    dva = await provisionPlatformDva({ schoolId: ctx.schoolId, schoolName: school?.name || 'School', email: owner.email })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not set up bank transfer. Try again.'
    return { error: msg }
  }

  const now = new Date().toISOString()
  const { error: upsertError } = await svc.from('platform_billing').upsert(
    {
      school_id: ctx.schoolId,
      setup_fee_amount: amount,
      billing_method: 'dva',
      // Persist the enablement so the state is consistent on later loads (the
      // owner just self-enabled transfer, or Fees101 already had).
      dva_fallback_enabled: true,
      mandate_email: owner.email,
      platform_dva_reference: dva.reference,
      platform_dva_account_number: dva.accountNumber,
      platform_dva_bank_name: dva.bankName,
      platform_dva_bank_code: dva.bankCode,
      platform_dva_created_at: now,
      terms_accepted_at: now,
      terms_accepted_by: ctx.userId,
      terms_version: BILLING_TERMS_VERSION,
      updated_at: now,
    },
    { onConflict: 'school_id' },
  )
  if (upsertError) return { error: 'Could not save billing details. Try again.' }

  return { accountNumber: dva.accountNumber, bankName: dva.bankName, amount }
}
