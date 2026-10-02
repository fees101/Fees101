import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { verifyPaystackWebhookSignature } from './paystack'
import { applyFailedCharge, applySuccessfulCharge } from './reconcile'

// Platform-billing webhook processor. Paystack posts here from the PLATFORM
// account (the one that holds the direct-debit mandates), so there is a single
// fixed URL and we verify against PLATFORM_PAYSTACK_SECRET_KEY — unlike the
// school-side webhook, which is per-school because each school has its own key.
//
// Why we need it even though the setup-fee callback already confirms payment:
//   - Recurring debits (slice 2) settle ASYNCHRONOUSLY. charge_authorization
//     first returns "processing"; the real result arrives only as a
//     charge.success / charge.failed webhook. Without this we can't know a
//     monthly debit actually landed.
//   - The mandate goes "active" ~3h after setup, announced by
//     direct_debit.authorization.active. This records that so the first
//     recurring charge can proceed.
//   - It is a backstop for the setup fee itself: if the browser never made it
//     back to the callback, charge.success still records the payment.
//
// Everything here is idempotent (keyed on the Paystack reference / auth code)
// because Paystack retries a webhook until it gets a 2xx.

type WebhookResult = { status: number; body: unknown }

// References we create look like "setup_<schoolId>_<ts>" or "due_<schoolId>_<ts>".
// A school id is a UUID (hyphens, no underscores), so splitting on "_" is safe.
function parseReference(ref?: string | null): { kind: 'setup' | 'due' | null; schoolId: string | null } {
  if (!ref) return { kind: null, schoolId: null }
  const parts = ref.split('_')
  if (parts.length >= 2 && (parts[0] === 'setup' || parts[0] === 'due')) {
    return { kind: parts[0] as 'setup' | 'due', schoolId: parts[1] || null }
  }
  return { kind: null, schoolId: null }
}

export async function processPlatformPaystackWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  // Verify first, against the exact bytes Paystack sent.
  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    return { status: 401, body: { error: 'invalid signature' } }
  }

  let event: { event?: string; data?: Record<string, unknown> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return { status: 400, body: { error: 'invalid json' } }
  }

  const type = event.event || ''
  const data = (event.data || {}) as Record<string, unknown>
  const svc = createServiceRoleClient()
  const now = new Date().toISOString()

  // --- Mandate became chargeable ------------------------------------------
  // Flip mandate_status to active. Match by authorization code, then email.
  if (
    type === 'direct_debit.authorization.active' ||
    type === 'direct_debit.authorization.created'
  ) {
    const authObj = (data.authorization as Record<string, unknown>) || {}
    const authCode =
      (data.authorization_code as string) || (authObj.authorization_code as string) || null
    const email =
      ((data.customer as Record<string, unknown>)?.email as string) ||
      (data.email as string) ||
      null

    // Only the "active" event actually makes it chargeable; "created" just
    // records consent (we already set 'pending' at the callback).
    const newStatus = type === 'direct_debit.authorization.active' ? 'active' : 'pending'

    let query = svc.from('platform_billing').update({
      mandate_status: newStatus,
      ...(newStatus === 'active' ? { mandate_active_at: now } : {}),
      updated_at: now,
    })
    if (authCode) query = query.eq('mandate_authorization_code', authCode)
    else if (email) query = query.eq('mandate_email', email)
    else return { status: 200, body: { received: true, note: 'no auth code or email to match' } }

    await query
    return { status: 200, body: { received: true, handled: type } }
  }

  // --- A charge succeeded (setup fee backstop, or a recurring debit) -------
  if (type === 'charge.success') {
    const reference = (data.reference as string) || null
    const { kind, schoolId } = parseReference(reference)
    if (!reference || !schoolId) {
      // Not one of ours (or an unexpected reference shape). Ack so Paystack
      // stops retrying; nothing to record.
      return { status: 200, body: { received: true, ignored: 'unrecognized reference' } }
    }

    const amountNaira = typeof data.amount === 'number' ? data.amount / 100 : 0
    const paidAt = (data.paid_at as string) || now
    const chargedBy = kind === 'setup' ? 'setup_fee' : 'monthly_fee'

    // Idempotent: if we already recorded this reference (e.g. the setup-fee
    // callback did, or a Paystack retry), just make sure it reads success.
    const { data: existing } = await svc
      .from('platform_billing_charges')
      .select('id, status, period_id')
      .eq('paystack_reference', reference)
      .maybeSingle()

    if (existing) {
      // Only act on the pending -> success transition, once, so a retried
      // webhook never credits the period twice.
      if (existing.status !== 'success') {
        await svc
          .from('platform_billing_charges')
          .update({ status: 'success', paid_at: paidAt })
          .eq('id', existing.id)
        if (kind === 'due') {
          await applySuccessfulCharge(svc, {
            schoolId,
            reference,
            amountNaira,
            paidAt,
            periodId: existing.period_id ?? null,
          })
        }
      }
    } else {
      await svc.from('platform_billing_charges').insert({
        school_id: schoolId,
        amount: amountNaira,
        status: 'success',
        paystack_reference: reference,
        method: 'direct_debit',
        paid_at: paidAt,
        charged_by: chargedBy,
      })
    }

    return { status: 200, body: { received: true, handled: type, reference } }
  }

  // --- A charge failed (recurring debit; feeds slice-2 dunning) ------------
  if (type === 'charge.failed') {
    const reference = (data.reference as string) || null
    const { kind, schoolId } = parseReference(reference)
    if (reference && schoolId && kind === 'due') {
      const amountNaira = typeof data.amount === 'number' ? data.amount / 100 : 0
      const { data: existing } = await svc
        .from('platform_billing_charges')
        .select('id')
        .eq('paystack_reference', reference)
        .maybeSingle()
      if (!existing) {
        await svc.from('platform_billing_charges').insert({
          school_id: schoolId,
          amount: amountNaira,
          status: 'failed',
          paystack_reference: reference,
          method: 'direct_debit',
          paid_at: null,
          charged_by: 'monthly_fee',
        })
      }
      // Nudge the school into the dunning ladder's first rung; the ladder (run
      // by the charge-mandates cron) escalates from there by days overdue.
      await applyFailedCharge(svc, schoolId)
    }
    // Suspension/retry ladder runs in the cron; here we record the failure and
    // flag the account as due.
    return { status: 200, body: { received: true, handled: type } }
  }

  // Anything else: acknowledge so Paystack stops retrying.
  return { status: 200, body: { received: true, ignored: type } }
}
