// Handles an inbound Paystack webhook end to end: save raw payload, verify
// signature, parse, dedupe, and cascade the payment across the student's
// outstanding invoices. Mirror of processMonnifyWebhook — same persistence and
// idempotency guarantees — but parses Paystack's charge.success shape and
// matches the student by customer_code (which we store as provider_dva_reference).

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getPaymentProviderForSchool } from './getProvider'
import { applyProviderPayment } from './applyPayment'
import { logAuditEvent } from '@/lib/audit/logAudit'

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

  // Only successful charges move money. Everything else (assign events, failed
  // charges, transfers) is acknowledged but not acted on.
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

  if (!transactionReference || !customerCode) {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: 'Missing reference or customer.customer_code in payload',
    })
    return { status: 200, body: { message: 'Captured, missing required fields' } }
  }

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('provider_dva_reference', customerCode)
    .eq('school_id', schoolId)
    .maybeSingle()

  if (!student) {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: `No student found for customer code "${customerCode}"`,
    })
    return { status: 200, body: { message: 'Captured, no matching student' } }
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

  try {
    const { paymentIds, appliedInvoices, creditBalanceAmount } = await applyProviderPayment({
      supabase,
      schoolId,
      studentId: student.id,
      amountPaid,
      settlementAmount,
      provider: 'paystack',
      providerReference: transactionReference,
      providerTransactionId: transactionReference,
      paidAt: paidOn,
    })

    await updateWebhookEvent(supabase, eventId, {
      status: 'processed',
      processed_at: new Date().toISOString(),
      related_payment_ids: paymentIds,
    })

    for (const applied of appliedInvoices) {
      await logAuditEvent(supabase, {
        schoolId,
        actorId: null,
        action: 'payment.applied',
        targetType: 'invoice',
        targetId: applied.invoiceId,
        summary: `Applied payment of ₦${applied.amount.toLocaleString()} to invoice ${applied.invoiceId}`,
        metadata: {
          studentId: student.id,
          paymentId: applied.paymentId,
          amount: applied.amount,
          providerReference: transactionReference,
          providerTransactionId: transactionReference,
          oldStatus: applied.oldStatus,
          newStatus: applied.newStatus,
        },
      })
    }

    if (creditBalanceAmount > 0) {
      await logAuditEvent(supabase, {
        schoolId,
        actorId: null,
        action: 'payment.applied',
        targetType: 'student',
        targetId: student.id,
        summary: `Applied overpayment of ₦${creditBalanceAmount.toLocaleString()} to student credit balance`,
        metadata: {
          studentId: student.id,
          amount: creditBalanceAmount,
          providerReference: transactionReference,
          providerTransactionId: transactionReference,
        },
      })
    }

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
