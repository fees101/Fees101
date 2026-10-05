import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { verifyTransaction } from '@/lib/platformBilling/paystack'
import { logAuditEvent } from '@/lib/audit/logAudit'

// Paystack redirect target for the "switch to mandate" checkout, started by
// startSwitchToMandate() in ../../actions.ts. This is deliberately a separate
// route from /connect-billing/callback: that one assumes a school that is NOT
// yet connected (it gates on billing_connected_at being unset, and sets it on
// success) and records the one-time setup fee. Here the school is already
// connected and switching collection method — overloading the same route
// with a mode flag would mean threading an already-connected/not-yet-connected
// branch through code whose contracts assume the opposite, which is worse
// than two small, single-purpose routes.

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const reference = url.searchParams.get('reference') || url.searchParams.get('trxref')

  const back = (code: string) =>
    NextResponse.redirect(new URL(`/team/platform-billing?error=${code}`, request.url))

  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return NextResponse.redirect(new URL('/login', request.url))
  if (!reference) return back('missing_reference')

  // The reference is namespaced with the school id at init time; checking the
  // prefix against the authenticated session's schoolId is enough to scope it
  // here (platform_billing has one row per school, so there is no separate
  // "pending reference" column to compare against as with the setup-fee flow).
  if (!reference.startsWith(`mandate_switch_${ctx.schoolId}_`)) return back('reference_mismatch')

  const svc = createServiceRoleClient()

  const { data: billing } = await svc
    .from('platform_billing')
    .select('billing_connected_at, mandate_email')
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!billing?.billing_connected_at) return back('not_connected')

  let tx
  try {
    tx = await verifyTransaction(reference)
  } catch {
    return back('verify_failed')
  }

  if (tx.status !== 'success') return back('payment_failed')

  const authCode = tx.authorization?.authorization_code || null
  // Only switch to auto-debit when the authorization is actually REUSABLE.
  // Paystack confirmed (2026-10-05) reusability is issuer/tokenisation-dependent,
  // not guaranteed by scheme — a non-reusable card can't be charged monthly, so
  // switching would store a dead mandate and break every future debit. In that
  // case keep the school on their existing DVA/bank-transfer rail.
  const mandateUsable = !!authCode && tx.authorization?.reusable === true

  const now = new Date().toISOString()

  // The validation charge happened on the card either way — record it for the
  // charge history / reconciliation before branching.
  await svc.from('platform_billing_charges').insert({
    school_id: ctx.schoolId,
    amount: (tx.amount || 0) / 100,
    status: 'success',
    paystack_reference: reference,
    method: 'direct_debit',
    paid_at: now,
    charged_by: 'mandate_switch',
  })

  if (!mandateUsable) {
    // No usable mandate — do NOT change billing_method; the school stays on DVA.
    await logAuditEvent(svc, {
      schoolId: ctx.schoolId,
      actorId: ctx.userId,
      action: 'platform_billing.method_change_failed',
      summary: authCode
        ? 'Switch to automatic bank debit failed — card not reusable; remained on bank transfer'
        : 'Switch to automatic bank debit failed — no mandate returned; remained on bank transfer',
    })
    return back(authCode ? 'card_not_reusable' : 'no_mandate')
  }

  await svc
    .from('platform_billing')
    .update({
      billing_method: 'mandate',
      mandate_authorization_code: authCode,
      mandate_email: tx.customer?.email || billing.mandate_email,
      mandate_status: 'pending', // Paystack takes ~3h to make it chargeable
      mandate_authorized_at: now,
      mandate_deactivated_at: null,
      updated_at: now,
    })
    .eq('school_id', ctx.schoolId)

  await logAuditEvent(svc, {
    schoolId: ctx.schoolId,
    actorId: ctx.userId,
    action: 'platform_billing.method_changed',
    summary: 'Switched platform billing to automatic bank debit',
  })

  return NextResponse.redirect(new URL('/team/platform-billing?switched=mandate', request.url))
}
