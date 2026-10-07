// Shared "open the billing gate" logic for a paid setup fee.
//
// This is the single source of truth for the connect step so the two places
// that can observe a paid setup fee can never drift:
//   - the synchronous browser callback (connect-billing/callback/route.ts) is
//     the fast path — it runs the instant Paystack redirects the owner back;
//   - the platform webhook (lib/platformBilling/webhook.ts) is the reliable
//     backstop — it opens the gate even if the browser never made it back to
//     the callback (closed tab, lost redirect, flaky network).
//
// Everything here is idempotent: connecting an already-connected school is a
// no-op, and the setup charge row is recorded at most once (keyed on the
// Paystack reference). Both callers may run against the same transaction.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { provisionPlatformDva } from './paystack'
import { logAuditEvent } from '@/lib/audit/logAudit'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

// Postgres unique_violation. If the setup-charge insert races (callback and
// webhook both firing), the loser gets this and we treat it as "already
// recorded" rather than an error. Backs the M1 unique index on
// platform_billing_charges(paystack_reference).
const UNIQUE_VIOLATION = '23505'

export type ConnectOutcome =
  // The gate was already open — nothing changed (but we still ensure the setup
  // charge row exists, so a late webhook after the callback is still recorded).
  | { status: 'already_connected' }
  // We opened the gate on this call.
  | { status: 'connected'; method: 'mandate' | 'dva'; dvaProvisioned: boolean }

// Record the one-time setup charge exactly once, keyed on the Paystack
// reference. A row already present (callback beat the webhook, or a Paystack
// retry) is a no-op; a unique-violation race is treated the same way.
async function recordSetupChargeOnce(
  svc: ServiceClient,
  p: { schoolId: string; reference: string; amountNaira: number; method: string; paidAt: string },
): Promise<void> {
  const { data: existing } = await svc
    .from('platform_billing_charges')
    .select('id')
    .eq('paystack_reference', p.reference)
    .maybeSingle()
  if (existing) return

  const { error } = await svc.from('platform_billing_charges').insert({
    school_id: p.schoolId,
    amount: p.amountNaira,
    status: 'success',
    paystack_reference: p.reference,
    method: p.method,
    paid_at: p.paidAt,
    charged_by: 'setup_fee',
  })
  // A concurrent insert won the race and already recorded this reference — the
  // charge is on file, so this is success, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`Failed to record setup charge: ${error.message}`)
  }
}

// Open the billing gate from a successful setup-fee CARD/BANK charge (the
// mandate-checkout rail). Mirrors exactly what connect-billing/callback did
// inline before it was extracted here. Pass the verified transaction's
// authorization block and customer email; actorId is the owner on the callback
// path and null (system) on the webhook path.
export async function connectBillingFromSetupCharge(params: {
  svc: ServiceClient
  schoolId: string
  reference: string
  amountNaira: number
  // The `authorization` object from the verified transaction / charge event.
  authorization: { authorization_code?: string | null; reusable?: boolean } | null
  customerEmail: string | null
  actorId?: string | null
  paidAt?: string | null
}): Promise<ConnectOutcome> {
  const { svc, schoolId, reference, amountNaira, authorization, customerEmail } = params
  const now = new Date().toISOString()
  const paidAt = params.paidAt || now

  // Idempotency gate: only the transition from "not connected" does work. An
  // already-open gate must never be re-opened or re-provisioned — but we still
  // make sure the setup charge is recorded (the webhook may arrive after a
  // callback that opened the gate but, in theory, before its charge row).
  const { data: billing } = await svc
    .from('platform_billing')
    .select('billing_connected_at, onboarding_at, mandate_email')
    .eq('school_id', schoolId)
    .maybeSingle()

  if (billing?.billing_connected_at) {
    await recordSetupChargeOnce(svc, {
      schoolId,
      reference,
      amountNaira,
      method: 'direct_debit',
      paidAt,
    })
    return { status: 'already_connected' }
  }

  const authCode = authorization?.authorization_code || null
  // A card/bank authorization is only a usable mandate when Paystack marks it
  // `reusable` — the scheme alone doesn't guarantee it (confirmed with Paystack
  // 2026-10-05). A non-reusable authorization can't be charged again, so storing
  // it as a mandate would make every recurring debit fail silently. Only treat a
  // reusable authorization as a mandate; otherwise fall to the DVA rail with the
  // mandate state cleared. This matches the callback's original gating exactly.
  const mandateUsable = !!authCode && authorization?.reusable === true

  if (!mandateUsable) {
    // Non-reusable card (or, defensively, no auth code): the setup fee was paid
    // but this authorization can't be charged monthly. Provision the Fees101 DVA
    // so the school has a working monthly rail, and open the gate directly (the
    // fee is already collected, unlike the plain DVA fallback which waits on a
    // setup transfer). Do NOT store the dead mandate.
    const { data: school } = await svc
      .from('schools')
      .select('name')
      .eq('id', schoolId)
      .maybeSingle()

    let dva: { reference: string; accountNumber: string; bankName: string; bankCode: string } | null = null
    try {
      dva = await provisionPlatformDva({
        schoolId,
        schoolName: school?.name || 'School',
        email: customerEmail || billing?.mandate_email || '',
      })
    } catch {
      // Couldn't provision the DVA right now. Still open the gate (the fee is
      // paid); billing settings can re-provision later. Never store a dead mandate.
      dva = null
    }

    await svc
      .from('platform_billing')
      .update({
        setup_fee_status: 'paid',
        setup_fee_paid_at: now,
        billing_method: 'dva',
        // This card genuinely can't hold a mandate, so DVA is now their rail —
        // mark the self-serve fallback enabled so state is consistent and the
        // switch-to-mandate path can invite them back later.
        dva_fallback_enabled: true,
        // Explicitly clear any mandate state — this authorization is not reusable.
        mandate_authorization_code: null,
        mandate_status: 'none',
        mandate_authorized_at: null,
        mandate_email: customerEmail || billing?.mandate_email,
        ...(dva
          ? {
              platform_dva_reference: dva.reference,
              platform_dva_account_number: dva.accountNumber,
              platform_dva_bank_name: dva.bankName,
              platform_dva_bank_code: dva.bankCode,
              platform_dva_created_at: now,
            }
          : {}),
        onboarding_at: billing?.onboarding_at || now, // free-period day 0
        billing_connected_at: now, // the entry-gate flag (setup fee is paid)
        updated_at: now,
      })
      .eq('school_id', schoolId)

    await recordSetupChargeOnce(svc, { schoolId, reference, amountNaira, method: 'direct_debit', paidAt })

    await logAuditEvent(svc, {
      schoolId,
      actorId: params.actorId ?? null,
      action: 'platform_billing.connected',
      summary: dva
        ? 'Connected platform billing via bank transfer (card not reusable for automatic debit)'
        : 'Connected platform billing; card not reusable for automatic debit — bank-transfer account pending',
    })

    return { status: 'connected', method: 'dva', dvaProvisioned: !!dva }
  }

  // Reusable mandate — the normal automatic-bank-debit path.
  await svc
    .from('platform_billing')
    .update({
      setup_fee_status: 'paid',
      setup_fee_paid_at: now,
      // A school may have looked at (or requested) the DVA fallback before
      // completing direct debit instead — billing_method must reflect whichever
      // path actually succeeded, not whichever was tried first.
      billing_method: 'mandate',
      mandate_authorization_code: authCode,
      mandate_email: customerEmail || billing?.mandate_email,
      // A reusable authorization is 'pending' until Paystack activates it (~3h);
      // verifyAuthorizationStatus confirms it before the first debit 65+ days out.
      mandate_status: 'pending',
      mandate_authorized_at: now,
      onboarding_at: billing?.onboarding_at || now, // free-period day 0
      billing_connected_at: now, // the entry-gate flag
      updated_at: now,
    })
    .eq('school_id', schoolId)

  await recordSetupChargeOnce(svc, { schoolId, reference, amountNaira, method: 'direct_debit', paidAt })

  await logAuditEvent(svc, {
    schoolId,
    actorId: params.actorId ?? null,
    action: 'platform_billing.connected',
    summary: 'Connected platform billing via automatic bank debit',
  })

  return { status: 'connected', method: 'mandate', dvaProvisioned: false }
}
