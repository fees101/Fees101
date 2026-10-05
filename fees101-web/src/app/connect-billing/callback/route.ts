import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { verifyTransaction, provisionPlatformDva } from '@/lib/platformBilling/paystack'
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
    // The mandate checkout failed (card declined, bank not supported, abandoned).
    // Auto-enable the self-serve bank-transfer fallback so the owner can pay by
    // transfer instead without waiting on anyone — this is the scalable
    // "eligibility" trigger: DVA unlocks itself from the checkout outcome, not an
    // owner click. (DVA is self-penalising — manual transfers forever — so this
    // isn't a lazy opt-out; a rational school still prefers the mandate.)
    await svc
      .from('platform_billing')
      .update({ setup_fee_status: 'failed', dva_fallback_enabled: true, updated_at: now })
      .eq('school_id', ctx.schoolId)
    return back('payment_failed')
  }

  const auth = tx.authorization
  const authCode = auth?.authorization_code || null
  // Paystack confirmed (2026-10-05): a card authorization's reusability is NOT
  // guaranteed by its scheme (Visa/Mastercard/Verve) — it's the `reusable` flag
  // on the returned authorization, and it depends on the issuer + its tokenisation.
  // A NON-reusable authorization cannot be charged again, so storing it as a
  // mandate would make every recurring debit fail silently (caught only much later
  // by the dunning ladder). Only treat it as a usable mandate when it is actually
  // reusable. Otherwise the setup fee is still paid, so we put the school on the
  // DVA (bank-transfer) rail for their monthly bills rather than a dead mandate.
  const mandateUsable = !!authCode && auth?.reusable === true

  // The setup-fee charge is recorded once, on whichever rail we land on.
  const recordSetupCharge = () =>
    svc.from('platform_billing_charges').insert({
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

  if (!mandateUsable) {
    // Non-reusable card (or, defensively, no auth code): the setup fee was paid on
    // this card, but it can't be charged monthly. Provision the Fees101 DVA now so
    // the school has a working monthly rail, and set billing_connected_at directly
    // (we don't ask for a setup-fee transfer to unlock — unlike the plain DVA
    // fallback — because the fee was already collected on the card here).
    const { data: school } = await svc
      .from('schools').select('name').eq('id', ctx.schoolId).maybeSingle()

    let dva: { reference: string; accountNumber: string; bankName: string; bankCode: string } | null = null
    try {
      dva = await provisionPlatformDva({
        schoolId: ctx.schoolId,
        schoolName: school?.name || 'School',
        email: tx.customer?.email || billing.mandate_email || '',
      })
    } catch {
      // Couldn't provision the DVA right now. Still let them in (the fee is paid);
      // billing settings can re-provision. Do NOT store the dead mandate.
      dva = null
    }

    await svc
      .from('platform_billing')
      .update({
        setup_fee_status: 'paid',
        setup_fee_paid_at: now,
        billing_method: 'dva',
        // This card genuinely can't hold a mandate, so DVA is now their rail —
        // mark the self-serve fallback enabled too, so the state is consistent
        // (and the switch-to-mandate path can still invite them back later).
        dva_fallback_enabled: true,
        // Explicitly clear any mandate state — this authorization is not reusable.
        mandate_authorization_code: null,
        mandate_status: 'none',
        mandate_authorized_at: null,
        mandate_email: tx.customer?.email || billing.mandate_email,
        ...(dva
          ? {
              platform_dva_reference: dva.reference,
              platform_dva_account_number: dva.accountNumber,
              platform_dva_bank_name: dva.bankName,
              platform_dva_bank_code: dva.bankCode,
              platform_dva_created_at: now,
            }
          : {}),
        onboarding_at: billing.onboarding_at || now, // free-period day 0
        billing_connected_at: now, // the entry-gate flag (setup fee is paid)
        updated_at: now,
      })
      .eq('school_id', ctx.schoolId)

    await recordSetupCharge()

    await logAuditEvent(svc, {
      schoolId: ctx.schoolId,
      actorId: ctx.userId,
      action: 'platform_billing.connected',
      summary: dva
        ? 'Connected platform billing via bank transfer (card not reusable for automatic debit)'
        : 'Connected platform billing; card not reusable for automatic debit — bank-transfer account pending',
    })

    // Land on billing settings so they immediately see their bank-transfer account
    // and the reason their card wasn't used for automatic debit.
    return NextResponse.redirect(
      new URL('/team/platform-billing?notice=card_fallback', request.url),
    )
  }

  // Reusable mandate — the normal automatic-bank-debit path.
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
      // A reusable bank/recurring authorization is 'pending' until Paystack
      // activates it (~3h); verifyAuthorizationStatus confirms it before the first
      // debit 65+ days out.
      mandate_status: 'pending',
      mandate_authorized_at: now,
      onboarding_at: billing.onboarding_at || now, // free-period day 0
      billing_connected_at: now, // the entry-gate flag
      updated_at: now,
    })
    .eq('school_id', ctx.schoolId)

  await recordSetupCharge()

  await logAuditEvent(svc, {
    schoolId: ctx.schoolId,
    actorId: ctx.userId,
    action: 'platform_billing.connected',
    summary: 'Connected platform billing via automatic bank debit',
  })

  return NextResponse.redirect(new URL('/today', request.url))
}
