// Handles an inbound Monnify webhook end to end: save raw payload, verify
// signature, parse, dedupe, and cascade the payment across the student's
// outstanding invoices. Kept separate from route.ts so the route itself
// stays a thin adapter between Next.js and this.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getPaymentProviderForSchool } from './getProvider'
import { applyMonnifyPayment } from './applyPayment'

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

export async function processMonnifyWebhook(
  schoolId: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<ProcessResult> {
  const supabase = createServiceRoleClient()

  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) {
    // Can't verify anything without credentials — log what we can and bail.
    await supabase.from('webhook_events').insert({
      school_id: schoolId,
      provider: 'monnify',
      raw_payload: safeParse(rawBody),
      signature_header: signatureHeader,
      status: 'error',
      error_message: 'No payment provider configured for this school',
    })
    return { status: 400, body: { error: 'No payment provider configured for this school' } }
  }

  // Save the raw delivery FIRST, before verification — every attempt (valid,
  // forged, or malformed) gets an audit row. webhook_events is append-only:
  // one row per HTTP delivery, including retries of the same transaction.
  const { data: eventRow, error: insertEventError } = await supabase
    .from('webhook_events')
    .insert({
      school_id: schoolId,
      provider: 'monnify',
      raw_payload: safeParse(rawBody),
      signature_header: signatureHeader,
      status: 'received',
    })
    .select('id')
    .single()

  if (insertEventError || !eventRow) {
    // We couldn't even log it — nothing else to do but fail loudly.
    return { status: 500, body: { error: 'Failed to record webhook event' } }
  }

  const eventId = eventRow.id as string

  // Verify against the raw text, never a re-serialized/parsed version —
  // JSON.stringify(parsed) is not guaranteed to reproduce Monnify's exact
  // bytes (key order, number formatting), which would break every signature.
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

  const eventType = parsed.eventType as string | undefined
  const eventData = parsed.eventData || {}
  const transactionReference = eventData.transactionReference as string | undefined
  const dvaReference = eventData.product?.reference as string | undefined

  await updateWebhookEvent(supabase, eventId, {
    event_type: eventType || null,
    transaction_reference: transactionReference || null,
    status: 'processing',
  })

  if (eventType !== 'SUCCESSFUL_TRANSACTION') {
    // Some other Monnify event we don't act on yet — acknowledged, not an error.
    await updateWebhookEvent(supabase, eventId, { status: 'processed', processed_at: new Date().toISOString() })
    return { status: 200, body: { message: `Acknowledged, no handler for eventType ${eventType}` } }
  }

  if (!transactionReference || !dvaReference) {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: 'Missing transactionReference or product.reference in payload',
    })
    return { status: 200, body: { message: 'Captured, missing required fields' } }
  }

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('provider_dva_reference', dvaReference)
    .eq('school_id', schoolId)
    .maybeSingle()

  if (!student) {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: `No student found for DVA reference "${dvaReference}"`,
    })
    return { status: 200, body: { message: 'Captured, no matching student' } }
  }

  const amountPaid = Number(eventData.amountPaid || 0)
  const settlementAmount = Number(eventData.settlementAmount || 0)
  const paidOn = eventData.paidOn ? new Date(eventData.paidOn.replace(' ', 'T')).toISOString() : new Date().toISOString()

  // Claim the transaction before doing any real work. This is the actual
  // idempotency guarantee, not the pre-checks above — two near-simultaneous
  // retries of the same delivery can both pass a pre-check before either
  // has inserted, but only one can win this unique constraint. Idempotency
  // can't live on payments itself anymore: one real transaction can produce
  // several payments rows (cascaded across multiple invoices), so no single
  // row's provider_transaction_id can be the uniqueness boundary.
  const { error: claimError } = await supabase
    .from('processed_provider_transactions')
    .insert({
      school_id: schoolId,
      provider: 'monnify',
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

  try {
    const { paymentIds } = await applyMonnifyPayment({
      supabase,
      schoolId,
      studentId: student.id,
      amountPaid,
      settlementAmount,
      providerReference: eventData.paymentReference || transactionReference,
      providerTransactionId: transactionReference,
      paidAt: paidOn,
    })

    await updateWebhookEvent(supabase, eventId, {
      status: 'processed',
      processed_at: new Date().toISOString(),
      related_payment_ids: paymentIds,
    })

    return { status: 200, body: { success: true } }
  } catch (err: any) {
    // The transaction is already claimed at this point, so a retry from
    // Monnify would be treated as a duplicate and never retried by us
    // automatically — this needs to surface for manual follow-up rather
    // than silently vanishing.
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
