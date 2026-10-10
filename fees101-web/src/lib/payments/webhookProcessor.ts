// Handles an inbound Monnify webhook end to end: save raw payload, verify
// signature, parse, dedupe, and cascade the payment across the owner's
// outstanding invoices. Kept separate from route.ts so the route itself
// stays a thin adapter between Next.js and this.
//
// Also handles Monnify's refund-completion webhook (see the REFUND branch
// below), the Monnify-side equivalent of paystackWebhookProcessor.ts's
// refund.processed/refund.failed handling — same detect-and-flag pattern,
// reusing externalMoneyLoss.ts and the confirm_external_refund/refunds-table
// machinery as-is. Monnify (bank transfer/reserved-account collections) has
// no card-dispute/chargeback concept the way Paystack's card rail does, so
// there is no Monnify equivalent of charge.dispute.create/resolve here.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getPaymentProviderForSchool } from './getProvider'
import { applyProviderPayment, resolveDvaOwner } from './applyPayment'
import { finalizeCompletedRefund } from './completeRefund'
import { recordExternalMoneyLoss } from './externalMoneyLoss'

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

  // Refund confirmation — mirrors the Paystack webhook's refund.processed/
  // refund.failed branch exactly: detect, flag, never auto-reconcile the
  // ledger from here. Monnify's exact refund webhook eventType is not
  // confirmed against a live delivery (this session had no completed Monnify
  // transaction to refund) — matched defensively on any eventType containing
  // "REFUND" rather than one hardcoded guess, with the actual outcome read
  // from eventData.refundStatus/status so a close-but-not-exact type name
  // still gets handled instead of silently falling through to "no handler".
  if (eventType && eventType.toUpperCase().includes('REFUND')) {
    const monnifyRefundId = eventData?.refundReference ? String(eventData.refundReference) : undefined
    const refundStatus = String(eventData?.refundStatus || eventData?.status || '').toUpperCase()
    const failed = refundStatus === 'FAILED' || refundStatus === 'REJECTED' || refundStatus === 'DECLINED' || eventType.toUpperCase().includes('FAILED')
    const succeeded = !failed && (refundStatus === 'COMPLETED' || refundStatus === 'SUCCESSFUL' || eventType.toUpperCase().includes('SUCCESSFUL') || eventType.toUpperCase().includes('COMPLETED'))

    if (monnifyRefundId) {
      const { data: refundRow, error: lookupError } = await supabase
        .from('refunds')
        .select('id')
        .eq('school_id', schoolId)
        .eq('paystack_refund_id', monnifyRefundId) // reused column, see externalMoneyLoss.ts
        .eq('status', 'processing')
        .maybeSingle()

      if (lookupError) {
        await updateWebhookEvent(supabase, eventId, {
          status: 'error',
          error_message: `Failed to look up refund for ${eventType}: ${lookupError.message}`,
        })
        return { status: 500, body: { error: 'Failed to look up matching refund' } }
      }

      if (refundRow) {
        try {
          if (succeeded) {
            const { error: rpcError } = await supabase.rpc('complete_refund_request', {
              p_refund_id: refundRow.id,
              p_paystack_refund_id: monnifyRefundId,
            })
            if (rpcError) throw rpcError
            await finalizeCompletedRefund(supabase, refundRow.id)
          } else if (failed) {
            const { error: rpcError } = await supabase.rpc('fail_refund_request', {
              p_refund_id: refundRow.id,
              p_reason: eventData?.refundReason || eventData?.reason || 'Monnify reported the refund as failed',
            })
            if (rpcError) throw rpcError
          }
          // Neither succeeded nor failed (still pending) — nothing to do yet,
          // leave the row 'processing' for a later delivery or the sweep.
        } catch (err: any) {
          await updateWebhookEvent(supabase, eventId, {
            status: 'error',
            error_message: `Failed to apply ${eventType}: ${err?.message || 'unknown error'}`,
          })
          return { status: 200, body: { message: `Captured, failed to apply ${eventType}` } }
        }
      } else if (succeeded) {
        // No row we created matches this id — refunded directly on Monnify's
        // own dashboard, not requested through Fees101.
        try {
          await recordExternalMoneyLoss(
            supabase,
            schoolId,
            eventData?.transactionReference ? String(eventData.transactionReference) : undefined,
            Number(eventData?.refundAmount ?? eventData?.amountRefunded ?? 0),
            'monnify_reversal',
            monnifyRefundId,
          )
        } catch (err: any) {
          await updateWebhookEvent(supabase, eventId, {
            status: 'error',
            error_message: `Failed to record external refund: ${err?.message || 'unknown error'}`,
          })
          return { status: 200, body: { message: 'Captured, failed to record external refund' } }
        }
      }
      // No matching 'processing' row and not a success is fine — already
      // completed/failed, or a duplicate delivery. Not an error.
    }
    await updateWebhookEvent(supabase, eventId, { status: 'processed', processed_at: new Date().toISOString() })
    return { status: 200, body: { message: `Acknowledged ${eventType}` } }
  }

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

  const owner = await resolveDvaOwner(supabase, schoolId, dvaReference)

  if (!owner) {
    await updateWebhookEvent(supabase, eventId, {
      status: 'error',
      error_message: `No student or family found for DVA reference "${dvaReference}"`,
    })
    return { status: 200, body: { message: 'Captured, no matching student or family' } }
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
    const { paymentIds, appliedInvoices, creditBalanceAmount } = await applyProviderPayment({
      supabase,
      schoolId,
      ...owner,
      amountPaid,
      settlementAmount,
      provider: 'monnify',
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
