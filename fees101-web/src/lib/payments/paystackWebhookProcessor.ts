// Handles an inbound Paystack webhook end to end: save raw payload, verify
// signature, parse, dedupe, and apply the payment.
//
// Two collection rails land here:
//  - DVA / bank transfer: matched by customer_code (stored as
//    provider_dva_reference on a student or family), applied oldest-term-first.
//  - In-person Terminal (POS): a charge the bursar pushed to a physical device.
//    The completed charge.success is matched FIRST to an open
//    terminal_payment_requests row (by any identifier we stored at push time),
//    applied to that row's student/family through the SAME waterfall, and the
//    row is flipped to 'paid' so the front-desk modal closes out. Only then do
//    we fall through to the DVA customer_code path.
//
// Money moves only on charge.success. Terminal lifecycle events
// (paymentrequest.*/invoice.payment_failed) are status-only updates to the
// terminal row for the UI — they never move money, which keeps idempotency
// trivial (one processed_provider_transactions claim per transaction).

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getPaymentProviderForSchool } from './getProvider'
import { applyProviderPayment, resolveDvaOwner, resolveTerminalPaymentRequest } from './applyPayment'

interface ProcessResult {
  status: number
  body: Record<string, unknown>
}

async function updateWebhookEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  eventId: string,
  fields: Record<string, unknown>
) {
  await supabase.from('webhook_events').update(fields).eq('id', eventId)
}

// Pulls every identifier a terminal charge/paymentrequest event carries, mapped
// to the stored column it should match. Paystack-confirmed (2026-10-05): the
// reference we push lands in `data.reference`, and metadata we attach comes back
// in `data.metadata` — both on charge.success AND paymentrequest.success.
// Since we push the OFFLINE_REFERENCE as the push's reference, `data.reference`
// equals our stored `offline_reference`, so it's matched against that column;
// our own TERM- key travels in `metadata.fees101_reference` and matches the
// `reference` column. `data.id` is deliberately NOT used — on a charge it's the
// transaction id, which would mis-route a plain DVA charge to a terminal row.
function terminalCandidatesFromData(data: any): {
  reference?: string
  offlineReference?: string
  requestCode?: string
  paymentRequestId?: string
} {
  const meta = data?.metadata || {}
  const dataRef = data?.reference ? String(data.reference) : undefined
  const metaRef = meta?.fees101_reference ? String(meta.fees101_reference) : undefined
  return {
    // Our own key from metadata (exact match on the `reference` column); fall
    // back to data.reference in case metadata didn't round-trip.
    reference: metaRef ?? dataRef,
    // The pushed reference == our offline_reference, echoed in data.reference.
    offlineReference: dataRef ?? (data?.offline_reference ? String(data.offline_reference) : undefined),
    requestCode: (data?.request_code ?? meta?.request_code)
      ? String(data?.request_code ?? meta?.request_code)
      : undefined,
    paymentRequestId: (data?.payment_request_id ?? meta?.payment_request_id)
      ? String(data?.payment_request_id ?? meta?.payment_request_id)
      : undefined,
  }
}

export async function processPaystackWebhook(
  schoolId: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<ProcessResult> {
  const supabase = createServiceRoleClient()

  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) {
    await supabase.from('webhook_events').insert({
      school_id: schoolId,
      provider: 'paystack',
      raw_payload: safeParse(rawBody),
      signature_header: signatureHeader,
      status: 'error',
      error_message: 'No payment provider configured for this school',
    })
    return { status: 400, body: { error: 'No payment provider configured for this school' } }
  }

  // Save the raw delivery FIRST, before verification — every attempt (valid,
  // forged, or malformed) gets an audit row. webhook_events is append-only.
  const { data: eventRow, error: insertEventError } = await supabase
    .from('webhook_events')
    .insert({
      school_id: schoolId,
      provider: 'paystack',
      raw_payload: safeParse(rawBody),
      signature_header: signatureHeader,
      status: 'received',
    })
    .select('id')
    .single()

  if (insertEventError || !eventRow) {
    return { status: 500, body: { error: 'Failed to record webhook event' } }
  }

  const eventId = eventRow.id as string

  // Verify against the raw text, never a re-serialized version — Paystack signs
  // the exact bytes it sent (HMAC-SHA512 with the secret key).
  const signatureValid = provider.verifyWebhookSignature(rawBody, signatureHeader || '')
  if (!signatureValid) {
    await updateWebhookEvent(supabase, eventId, { status: 'invalid_signature' })
    return { status: 401, body: { error: 'Invalid signature' } }
  }

  let parsed: any
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: 'Signature valid but body is not valid JSON',
    })
    return { status: 200, body: { message: 'Captured, payload unparseable' } }
  }

  const eventType = parsed.event as string | undefined
  const data = parsed.data || {}
  const transactionReference = data.reference ? String(data.reference) : undefined
  const customerCode = data.customer?.customer_code as string | undefined

  await updateWebhookEvent(supabase, eventId, {
    event_type: eventType || null,
    transaction_reference: transactionReference || null,
    status: 'processing',
  })

  // Terminal lifecycle events: update the terminal row's status for the UI, move
  // no money. A missing match is fine (e.g. a device used outside Fees101).
  const TERMINAL_STATUS_EVENTS: Record<string, 'failed'> = {
    'paymentrequest.failed': 'failed',
    'invoice.payment_failed': 'failed',
  }
  if (eventType && TERMINAL_STATUS_EVENTS[eventType]) {
    const match = await resolveTerminalPaymentRequest(supabase, schoolId, terminalCandidatesFromData(data))
    if (match && match.status !== 'paid') {
      await supabase
        .from('terminal_payment_requests')
        .update({ status: TERMINAL_STATUS_EVENTS[eventType], updated_at: new Date().toISOString() })
        .eq('id', match.id)
    }
    await updateWebhookEvent(supabase, eventId, { status: 'processed', processed_at: new Date().toISOString() })
    return { status: 200, body: { message: `Acknowledged terminal status event ${eventType}` } }
  }

  // Only successful charges move money. Everything else (assign events, pending
  // payment requests, transfers) is acknowledged but not acted on.
  if (eventType !== 'charge.success') {
    await updateWebhookEvent(supabase, eventId, { status: 'processed', processed_at: new Date().toISOString() })
    return { status: 200, body: { message: `Acknowledged, no handler for event ${eventType}` } }
  }

  // A belt-and-braces guard: charge.success should always be status "success",
  // but never apply anything that isn't.
  if (data.status && data.status !== 'success') {
    await updateWebhookEvent(supabase, eventId, { status: 'processed', processed_at: new Date().toISOString() })
    return { status: 200, body: { message: `Acknowledged, charge status ${data.status}` } }
  }

  if (!transactionReference) {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: 'Missing reference in charge.success payload',
    })
    return { status: 200, body: { message: 'Captured, missing required fields' } }
  }

  // Resolve the owner. Try the Terminal rail FIRST — a pushed in-person charge
  // may also carry a known customer_code, and we want it recognised as a
  // terminal payment (so its row closes out) rather than a plain DVA transfer.
  const terminalMatch = await resolveTerminalPaymentRequest(
    supabase, schoolId, terminalCandidatesFromData(data)
  )

  let owner: { studentId: string } | { familyId: string } | null = null
  let isTerminal = false
  if (terminalMatch && (terminalMatch.studentId || terminalMatch.familyId)) {
    owner = terminalMatch.studentId
      ? { studentId: terminalMatch.studentId }
      : { familyId: terminalMatch.familyId as string }
    isTerminal = true
  } else if (customerCode) {
    owner = await resolveDvaOwner(supabase, schoolId, customerCode)
  }

  if (!owner) {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: customerCode
        ? `No student, family or terminal request found for customer code "${customerCode}"`
        : 'No terminal request matched and no customer.customer_code present',
    })
    return { status: 200, body: { message: 'Captured, no matching student, family or terminal request' } }
  }

  // Paystack amounts are in kobo. settlementAmount is amount minus Paystack's
  // fee (the student is still credited the full amountPaid).
  const amountPaid = Number(data.amount || 0) / 100
  const settlementAmount = (Number(data.amount || 0) - Number(data.fees || 0)) / 100
  const paidOn = data.paid_at ? new Date(data.paid_at).toISOString() : new Date().toISOString()

  // Claim the transaction before doing any real work — the real idempotency
  // guarantee. Two near-simultaneous retries can both pass the pre-checks, but
  // only one wins this unique (school_id, provider, provider_transaction_id).
  const { error: claimError } = await supabase
    .from('processed_provider_transactions')
    .insert({
      school_id: schoolId,
      provider: 'paystack',
      provider_transaction_id: transactionReference,
    })

  if (claimError) {
    if (claimError.code === '23505') {
      await updateWebhookEvent(supabase, eventId, { status: 'duplicate' })
      return { status: 200, body: { message: 'Duplicate delivery, already processed' } }
    }
    await updateWebhookEvent(supabase, eventId, { status: 'error', error_message: claimError.message })
    return { status: 200, body: { message: 'Captured, failed to claim transaction' } }
  }

  // A distinct transaction matching a terminal request that is ALREADY paid is an
  // anomaly, not a normal duplicate (which the claim above caught by reference):
  // it means a second real charge hit a request we'd already settled. Do NOT
  // re-apply (that would double-collect against the same request). Flag it for a
  // human to reconcile and acknowledge. The raw delivery is in webhook_events.
  if (isTerminal && terminalMatch && terminalMatch.status === 'paid') {
    try {
      await supabase.from('admin_notifications').insert({
        school_id: schoolId,
        type: 'terminal_repeat_payment',
        title: 'Repeat payment on an already-settled terminal charge',
        body: `A ₦${amountPaid.toLocaleString()} charge (ref ${transactionReference}) ` +
          `matched a terminal request that was already marked paid. It was NOT re-applied — confirm whether this is a genuine second payment to reconcile manually.`,
      })
    } catch {
      // flag is best-effort — never block acknowledgement
    }
    await updateWebhookEvent(supabase, eventId, {
      status: 'processed',
      processed_at: new Date().toISOString(),
      error_message: 'Terminal request already settled; repeat charge flagged, not re-applied',
    })
    return { status: 200, body: { message: 'Acknowledged, repeat terminal charge flagged (not re-applied)' } }
  }

  // Best-effort amount sanity check for the terminal rail: in Model A the device
  // charges the exact pushed amount, so a divergence between what was paid and
  // what we pushed is worth a human glance (money is still applied either way).
  if (isTerminal && terminalMatch && terminalMatch.amount > 0 && Math.abs(amountPaid - terminalMatch.amount) > 0.5) {
    try {
      await supabase.from('admin_notifications').insert({
        school_id: schoolId,
        type: 'terminal_amount_mismatch',
        title: 'Terminal payment amount differs from what was charged',
        body: `Pushed ₦${terminalMatch.amount.toLocaleString()} but ₦${amountPaid.toLocaleString()} was paid ` +
          `(ref ${transactionReference}). The full amount was applied; confirm it matches what was expected.`,
      })
    } catch {
      // best-effort only
    }
  }

  try {
    const { paymentIds } = await applyProviderPayment({
      supabase,
      schoolId,
      ...owner,
      amountPaid,
      settlementAmount,
      provider: 'paystack',
      method: isTerminal ? 'provider_terminal' : 'provider_dva',
      providerReference: transactionReference,
      providerTransactionId: transactionReference,
      paidAt: paidOn,
    })

    // Close out the terminal request so the front-desk modal flips to "Paid".
    if (isTerminal && terminalMatch) {
      await supabase
        .from('terminal_payment_requests')
        .update({
          status: 'paid',
          applied_payment_ids: paymentIds,
          updated_at: new Date().toISOString(),
        })
        .eq('id', terminalMatch.id)
    }

    await updateWebhookEvent(supabase, eventId, {
      status: 'processed',
      processed_at: new Date().toISOString(),
      related_payment_ids: paymentIds,
    })

    return { status: 200, body: { success: true } }
  } catch (err: any) {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: err?.message || 'Failed to apply payment',
    })
    return { status: 200, body: { message: 'Captured, failed to apply payment' } }
  }
}

function safeParse(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody)
  } catch {
    return { _unparseable: true, raw: rawBody }
  }
}
