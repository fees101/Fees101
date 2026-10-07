import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { verifyTransaction } from '@/lib/platformBilling/paystack'
import { connectBillingFromSetupCharge } from '@/lib/platformBilling/connect'
import { classifyMandateFailure, MANDATE_SOFT_FAIL_THRESHOLD } from '@/lib/platformBilling/config'

// Paystack redirects the owner here after the setup-fee checkout. We verify the
// transaction server-to-server (the redirect params alone aren't trustworthy),
// and on success: mark the setup fee paid, capture the mandate
// (authorization_code), start the free-period clock (onboarding_at), and set
// billing_connected_at — which is what the app-layout gate keys off, so the
// owner can enter immediately. The mandate itself takes ~3h to become
// chargeable; that's confirmed lazily before the first recurring debit 65+ days
// out, so nothing here waits on it.

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  // Paystack sends both `reference` and `trxref`; they're equal.
  const reference = url.searchParams.get('reference') || url.searchParams.get('trxref')

  const back = (code: string) =>
    NextResponse.redirect(new URL(`/connect-billing?error=${code}`, request.url))

  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return NextResponse.redirect(new URL('/login', request.url))
  if (!reference) return back('missing_reference')

  const svc = createServiceRoleClient()

  // The reference was stored at init — confirm it belongs to this school before
  // trusting it (stops a reference from another school being replayed here).
  const { data: billing } = await svc
    .from('platform_billing')
    .select('setup_fee_reference, mandate_email, onboarding_at, billing_connected_at, mandate_attempt_count')
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!billing || billing.setup_fee_reference !== reference) return back('reference_mismatch')
  // Already connected (double submit / refresh of the callback) — just go in.
  if (billing.billing_connected_at) return NextResponse.redirect(new URL('/today', request.url))

  let tx
  try {
    tx = await verifyTransaction(reference)
  } catch {
    return back('verify_failed')
  }

  const now = new Date().toISOString()

  if (tx.status !== 'success') {
    // The mandate checkout didn't succeed (declined card, bank not supported,
    // abandoned). Decide whether to smart-enable the bank-transfer fallback now,
    // keeping the auto-debit mandate as the pushed path for recoverable blips:
    //   - HARD failure (bank can't do direct debit, or abandoned): open transfer
    //     immediately — retrying a bank that will never work just frustrates them.
    //   - TRANSIENT failure (declined/timeout): let them retry; only open transfer
    //     once they've crossed MANDATE_SOFT_FAIL_THRESHOLD attempts (the attempt
    //     was already counted in startBillingConnection).
    // DVA is self-penalising (manual transfers forever), so this isn't a lazy
    // opt-out; a rational school still prefers the mandate. Fees101 can also enable
    // it manually from the console, and hand-holds the first schools.
    const kind = classifyMandateFailure(tx.status, tx.gateway_response)
    const attemptCount = billing.mandate_attempt_count ?? 0
    const unlock = kind === 'hard' || attemptCount >= MANDATE_SOFT_FAIL_THRESHOLD
    await svc
      .from('platform_billing')
      .update({
        setup_fee_status: 'failed',
        mandate_last_failure_reason: tx.gateway_response || tx.status,
        ...(unlock ? { dva_fallback_enabled: true, dva_fallback_enabled_at: now } : {}),
        updated_at: now,
      })
      .eq('school_id', ctx.schoolId)
    // Tailor the message the connect screen shows: bank-unsupported vs retries
    // exhausted (both now offer transfer) vs a plain retry.
    const code = unlock ? (kind === 'hard' ? 'bank_unsupported' : 'mandate_retries_exhausted') : 'payment_failed'
    return back(code)
  }

  const auth = tx.authorization
  // The connect step (open the gate, provision the mandate or DVA, record the
  // setup charge, write the audit event) lives in the shared helper so this fast
  // path and the webhook backstop can never drift. It is idempotent, so a double
  // submit / refresh of this callback is safe.
  const outcome = await connectBillingFromSetupCharge({
    svc,
    schoolId: ctx.schoolId,
    reference,
    amountNaira: (tx.amount || 0) / 100,
    authorization: auth ? { authorization_code: auth.authorization_code, reusable: auth.reusable } : null,
    customerEmail: tx.customer?.email || billing.mandate_email || null,
    actorId: ctx.userId,
    paidAt: now,
  })

  // A non-reusable card landed the school on the DVA rail — send them to billing
  // settings so they immediately see their bank-transfer account and why the card
  // wasn't used for automatic debit. Everyone else goes straight into the app.
  if (outcome.status === 'connected' && outcome.method === 'dva') {
    return NextResponse.redirect(
      new URL('/team/platform-billing?notice=card_fallback', request.url),
    )
  }

  return NextResponse.redirect(new URL('/today', request.url))
}
