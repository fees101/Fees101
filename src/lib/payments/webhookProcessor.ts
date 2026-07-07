// Handles an inbound Monnify webhook end to end: save raw payload, verify
// signature, parse, dedupe, and (for now — Slice 3 replaces the inside of
// this) record a bare payments row. Kept separate from route.ts so the route
// itself stays a thin adapter between Next.js and this.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getPaymentProviderForSchool } from './getProvider'

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

  // --- STUB: Slice 3 replaces everything below this line ---
  // Real behavior belongs here: cascade the payment across the student's
  // oldest outstanding invoices first, spill any remainder into
  // students.credit_balance, and insert one payments row per invoice
  // touched. For now we just record that the money arrived, unattached to
  // any invoice, so Slice 2 is independently testable.
  const amountPaid = Number(eventData.amountPaid || 0)
  const settlementAmount = Number(eventData.settlementAmount || 0)
  const paidOn = eventData.paidOn ? new Date(eventData.paidOn.replace(' ', 'T')).toISOString() : new Date().toISOString()

  const { data: paymentRow, error: insertPaymentError } = await supabase
    .from('payments')
    .insert({
      school_id: schoolId,
      student_id: student.id,
      invoice_id: null, // Slice 3 assigns this
      amount: amountPaid,
      method: 'provider_dva',
      provider: 'monnify',
      provider_reference: eventData.paymentReference || transactionReference,
      provider_transaction_id: transactionReference,
      paid_at: paidOn,
      match_status: 'matched', // cryptographically verified — no manual review needed, unlike cash/POS entries
      notes: `settlementAmount=${settlementAmount} (Monnify fee not deducted from what the student is credited)`,
    })
    .select('id')
    .single()

  if (insertPaymentError) {
    // Unique violation on provider_transaction_id = a retry of a delivery
    // we already fully processed. This is the real idempotency guarantee —
    // the pre-checks above are not enough on their own since two close
    // retries can both pass them before either has inserted.
    if (insertPaymentError.code === '23505') {
      await updateWebhookEvent(supabase, eventId, { status: 'duplicate' })
      return { status: 200, body: { message: 'Duplicate delivery, already processed' } }
    }

    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: insertPaymentError.message,
    })
    return { status: 200, body: { message: 'Captured, failed to record payment' } }
  }

  await updateWebhookEvent(supabase, eventId, {
    status: 'processed',
    processed_at: new Date().toISOString(),
    related_payment_ids: [paymentRow.id],
  })

  return { status: 200, body: { success: true } }
}

function safeParse(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody)
  } catch {
    return { _unparseable: true, raw: rawBody }
  }
}
