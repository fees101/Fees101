import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { verifyTransaction } from '@/lib/platformBilling/paystack'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { FREE_DAYS } from '@/lib/platformBilling/config'

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
    .select('setup_fee_reference, mandate_email, onboarding_at, billing_connected_at')
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
    await svc
      .from('platform_billing')
      .update({ setup_fee_status: 'failed', updated_at: now })
      .eq('school_id', ctx.schoolId)
    return back('payment_failed')
  }

  const authCode = tx.authorization?.authorization_code || null

  await svc
    .from('platform_billing')
    .update({
      setup_fee_status: 'paid',
      setup_fee_paid_at: now,
      // A school may have looked at (or even requested) the DVA fallback before
      // coming back and completing direct debit instead — billing_method must
      // reflect whichever path actually succeeded, not whichever was tried first.
      billing_method: 'mandate',
      mandate_authorization_code: authCode,
      mandate_email: tx.customer?.email || billing.mandate_email,
      // A bank/recurring charge that succeeds yields a reusable mandate; it's
      // 'pending' until Paystack activates it (~3h). If no auth code came back
      // (shouldn't happen on the recurring flow), leave the mandate unset so a
      // later step can re-establish it — the setup fee still unlocks the app.
      mandate_status: authCode ? 'pending' : 'none',
      mandate_authorized_at: authCode ? now : null,
      onboarding_at: billing.onboarding_at || now, // free-period day 0
      billing_connected_at: now, // the entry-gate flag
      updated_at: now,
    })
    .eq('school_id', ctx.schoolId)

  // Record the setup charge in the shared charge history (amount back to naira).
  await svc.from('platform_billing_charges').insert({
    school_id: ctx.schoolId,
    amount: (tx.amount || 0) / 100,
    status: 'success',
    paystack_reference: reference,
    method: 'direct_debit',
    paid_at: now,
    charged_by: 'setup_fee',
  })

  // FREE_DAYS is imported to keep the free-period contract visible at the point
  // the clock starts; the accrual engine applies it off onboarding_at.
  void FREE_DAYS

  await logAuditEvent(svc, {
    schoolId: ctx.schoolId,
    actorId: ctx.userId,
    action: 'platform_billing.connected',
    summary: 'Connected platform billing via automatic bank debit',
  })

  return NextResponse.redirect(new URL('/today', request.url))
}
