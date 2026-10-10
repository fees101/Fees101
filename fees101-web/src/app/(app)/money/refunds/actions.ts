'use server'

import { revalidatePath } from 'next/cache'
import { getAuthContext, requirePermission, type AuthContext } from '@/lib/auth/permissions'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { REFUNDS_LIABILITY_VERSION } from '@/lib/platformBilling/config'
import { requireBillingActiveOrError } from '@/lib/platformBilling/requireBillingActive'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'
import { finalizeCompletedRefund } from '@/lib/payments/completeRefund'
import { friendlyWriteError } from '@/lib/errors/friendlyWriteError'

// Refunds for automatic (Paystack) payments — real money moves, unlike a
// manual-payment reversal (money/manual-payments/actions.ts), which only
// ever corrects the internal ledger. Same separation-of-duties shape though:
// a request is applied immediately when the requester is the owner (no one
// sits above them to approve it); everyone else's request waits for a
// different holder of approve-refunds.
//
// Every write re-checks the permission AND the feature gate (enabled by the
// console, liability accepted by the owner) server-side, independent of what
// the page chose to render. See db/refunds_workflow.sql for the RPCs this
// calls and why the ledger write happens where it does for each method.

const CATEGORIES = new Set(['overpayment', 'withdrawal', 'duplicate_payment', 'fee_correction', 'parent_request', 'other'])
const REFUND_METHODS = new Set(['paystack_reversal', 'monnify_reversal', 'bank_transfer'])
// Maps a payment's own recorded provider to the one automatic refund method
// that can actually move money back through it. A payment keeps whatever
// provider processed it even if the school later switches providers, so this
// is checked against the PAYMENT's provider, not the school's current one.
const PROVIDER_REFUND_METHOD: Record<string, string> = {
  paystack: 'paystack_reversal',
  monnify: 'monnify_reversal',
}
const MIN_REASON_LENGTH = 20
const MIN_REFERENCE_LENGTH = 3

type ActionResult = { success: true } | { error: string }

function isValidMoney(n: number): boolean {
  return Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
}
function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

// The RPCs raise plain, user-facing sentences. Surface that message directly
// when present, otherwise a generic fallback.
function rpcErrorMessage(err: { message?: string } | null | undefined, fallback: string): string {
  const m = (err?.message || '').trim()
  return m || fallback
}

async function actorName(ctx: AuthContext): Promise<string> {
  const { data } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()
  return data?.name || 'Unknown user'
}

// Self-serve (2026-10-09): usable by any school once its OWNER has accepted
// the current liability affirmation — no per-school enablement by Fees101
// staff. See db/refunds_self_serve.sql.
async function featureGateError(ctx: AuthContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from('schools')
    .select('refunds_liability_version')
    .eq('id', ctx.schoolId)
    .maybeSingle()
  if (data?.refunds_liability_version !== REFUNDS_LIABILITY_VERSION) {
    return 'The school owner must accept the refunds responsibility note before this can be used.'
  }
  return null
}

// ---------------------------------------------------------------------------
// The shared approval path. approve_refund_request does the authorization
// recheck + ledger write (bank_transfer) or claims the row for processing
// (paystack_reversal) in one SECURITY DEFINER transaction. For the Paystack
// path, the actual API call happens here, right after — a single HTTP call,
// same convention as every other synchronous paystack.ts call in this app
// (createDVA, verifyTransaction) — no background job needed.
// ---------------------------------------------------------------------------

interface RefundRow {
  id: string
  payment_id: string
  student_id: string
  amount: number
  refund_method: string
  refund_reference: string | null
  requested_by: string
  requested_by_name: string
}

async function applyApprovedRefund(
  ctx: AuthContext,
  refund: RefundRow,
  auto: boolean,
): Promise<ActionResult> {
  const { supabase, schoolId, userId } = ctx

  if (!ctx.isOwner && refund.requested_by === userId) {
    return { error: 'You cannot approve a refund you requested yourself.' }
  }

  const { data, error } = await supabase
    .rpc('approve_refund_request', {
      p_refund_id: refund.id,
      p_school_id: schoolId,
      p_reviewer_id: userId,
      p_auto: auto,
    })
    .single()
  if (error) return { error: rpcErrorMessage(error, 'Could not approve the refund.') }

  const row = data as any

  await logAuditEvent(supabase, {
    schoolId: schoolId as string,
    actorId: userId,
    action: 'payment.refund_approved',
    targetType: 'payment',
    targetId: refund.id,
    summary: auto
      ? `Requested and auto-approved a refund of ₦${Math.round(refund.amount).toLocaleString('en-NG')}`
      : `Approved a refund of ₦${Math.round(refund.amount).toLocaleString('en-NG')}`,
    metadata: { studentId: refund.student_id, paymentId: refund.payment_id, amount: refund.amount, refundMethod: refund.refund_method, autoApproved: auto },
  })

  // bank_transfer completes synchronously inside the RPC above.
  if (row?.result_status === 'completed') {
    await finalizeCompletedRefund(supabase, refund.id)
    revalidatePath('/money/refunds')
    return { success: true }
  }

  // paystack_reversal / monnify_reversal: the RPC only claimed the row
  // ('processing'). Call the matching provider now, then land the result.
  // Same shape for both — refundTransaction()/verifyRefund() are provider-
  // agnostic on PaymentProvider, and complete_refund_request/
  // fail_refund_request don't care which provider produced the id they're
  // given.
  const providerLabel = refund.refund_method === 'monnify_reversal' ? 'Monnify' : 'Paystack'
  const provider = await getPaymentProviderForSchool(schoolId as string, supabase)
  if (!provider?.refundTransaction || provider.name !== (refund.refund_method === 'monnify_reversal' ? 'monnify' : 'paystack')) {
    await supabase.rpc('fail_refund_request', { p_refund_id: refund.id, p_reason: `This school is not connected to ${providerLabel}.` })
    revalidatePath('/money/refunds')
    return { error: `This school is not connected to ${providerLabel}, so a ${providerLabel} refund could not be started. The request has been marked failed.` }
  }

  const { data: payment } = await supabase
    .from('payments')
    .select('provider_reference, provider_transaction_id')
    .eq('id', refund.payment_id)
    .maybeSingle()
  // provider_transaction_id, not provider_reference — confirmed live
  // 2026-10-10 against the real Monnify sandbox ("Transaction with specified
  // reference does not exist"). The two columns happen to hold the identical
  // value for every Paystack payment (both are stamped from data.reference in
  // paystackWebhookProcessor.ts), which is why this went unnoticed there, but
  // they are genuinely DIFFERENT Monnify identifiers: provider_reference
  // stores Monnify's merchant-supplied paymentReference, while
  // provider_transaction_id stores Monnify's own transactionReference — the
  // one every other Monnify call in this app (verifyTransaction) already
  // keys on, and the one its refund API actually expects.
  const reference = payment?.provider_transaction_id || payment?.provider_reference
  if (!reference) {
    await supabase.rpc('fail_refund_request', { p_refund_id: refund.id, p_reason: 'The original payment has no provider reference to refund.' })
    revalidatePath('/money/refunds')
    return { error: 'The original payment has no provider reference, so the refund could not be started. The request has been marked failed.' }
  }

  try {
    const result = await provider.refundTransaction(reference, refund.amount, `Refund: ${refund.refund_reference || 'school-initiated'}`)
    if (result.status === 'processed') {
      const { error: completeError } = await supabase
        .rpc('complete_refund_request', { p_refund_id: refund.id, p_paystack_refund_id: result.id })
        .single()
      if (completeError) return { error: rpcErrorMessage(completeError, `${providerLabel} confirmed the refund but it could not be recorded.`) }
      await finalizeCompletedRefund(supabase, refund.id)
    } else {
      // Still pending on the provider's side — stamp the id so the refund
      // webhook can find this row; status stays 'processing'.
      await supabase.from('refunds').update({ paystack_refund_id: result.id }).eq('id', refund.id).eq('status', 'processing')
    }
  } catch (err: any) {
    await supabase.rpc('fail_refund_request', { p_refund_id: refund.id, p_reason: err?.message || `${providerLabel} refund call failed` })
    revalidatePath('/money/refunds')
    return { error: err?.message || `The ${providerLabel} refund could not be started.` }
  }

  revalidatePath('/money/refunds')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Public actions.
// ---------------------------------------------------------------------------

export interface RequestRefundInput {
  paymentId: string
  amount: number
  category: string
  reason: string
  refundMethod: string
  // Required for bank_transfer: the proof the school already moved the money
  // (their own transfer reference/receipt number).
  refundReference?: string
}

export async function requestRefund(input: RequestRefundInput): Promise<ActionResult> {
  // M2: refunding money is core product use — gate on billing.
  const billingGate = await requireBillingActiveOrError()
  if (billingGate) return billingGate
  const ctx = await requirePermission('request-refunds')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const gate = await featureGateError(ctx)
  if (gate) return { error: gate }

  const rawAmount = Number(input.amount)
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return { error: 'Enter an amount greater than zero.' }
  if (!isValidMoney(rawAmount)) return { error: 'An amount can have at most two decimal places.' }
  const amount = roundMoney(rawAmount)
  if (!CATEGORIES.has(input.category)) return { error: 'Choose a reason category.' }
  const reason = (input.reason || '').trim()
  if (reason.length < MIN_REASON_LENGTH) return { error: `Explain the refund in at least ${MIN_REASON_LENGTH} characters.` }
  if (!REFUND_METHODS.has(input.refundMethod)) return { error: 'Choose how the refund will be made.' }

  const { supabase, schoolId, userId } = ctx

  const { data: payment } = await supabase
    .from('payments')
    .select('id, student_id, invoice_id, amount, provider')
    .eq('id', input.paymentId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!payment) return { error: 'That payment could not be found.' }
  if (!payment.provider) {
    return { error: 'Only automatically recorded payments can be refunded here; use a manual reversal for manually recorded payments.' }
  }

  let refundReference: string | null = null
  if (input.refundMethod === 'bank_transfer') {
    refundReference = (input.refundReference || '').trim()
    if (refundReference.length < MIN_REFERENCE_LENGTH) {
      return { error: `Add a reference of at least ${MIN_REFERENCE_LENGTH} characters as proof the bank transfer was made.` }
    }
  } else {
    // An automatic reversal must match the provider that actually processed
    // THIS payment (payment.provider, read above), not the school's current
    // setting — a school can switch providers while an old payment still
    // only exists on the one it was made through.
    const expectedMethod = PROVIDER_REFUND_METHOD[payment.provider as string]
    if (input.refundMethod !== expectedMethod) {
      const providerLabel = payment.provider === 'monnify' ? 'Monnify' : 'Paystack'
      return { error: `This payment was made through ${providerLabel} — use the ${providerLabel} refund method, or bank transfer instead.` }
    }
    refundReference = (input.refundReference || '').trim() || null
  }

  // Over-refund guard, checked here for a clean message; the RPC re-checks it
  // authoritatively at approval time.
  const { data: existingRefunds } = await supabase
    .from('refunds')
    .select('amount')
    .eq('payment_id', input.paymentId)
    .in('status', ['completed', 'processing'])
  const alreadyRefunded = (existingRefunds || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)
  if (alreadyRefunded + amount > Number(payment.amount) + 1e-6) {
    return { error: `This would refund more than remains on this payment (₦${Math.round(Number(payment.amount) - alreadyRefunded).toLocaleString('en-NG')} refundable).` }
  }

  const requestedByName = await actorName(ctx)
  const isOwner = ctx.isOwner

  const { data: inserted, error } = await supabase
    .from('refunds')
    .insert({
      school_id: schoolId,
      payment_id: input.paymentId,
      student_id: payment.student_id,
      invoice_id: payment.invoice_id,
      amount,
      category: input.category,
      reason,
      refund_method: input.refundMethod,
      refund_reference: refundReference,
      status: 'pending',
      requested_by: userId,
      requested_by_name: requestedByName,
    })
    .select('id, payment_id, student_id, amount, refund_method, refund_reference, requested_by, requested_by_name')
    .single()
  if (error || !inserted) {
    if (error?.code === '23505') return { error: 'A refund is already pending or being processed on this payment.' }
    return { error: friendlyWriteError(error, 'Could not request the refund.') }
  }

  // The owner has no one above them to approve, so their own requests apply
  // immediately — still through this table and the audit log, just auto-approved.
  if (isOwner) {
    const result = await applyApprovedRefund(ctx, inserted as RefundRow, true)
    if ('error' in result) {
      // The insert committed on its own; the apply runs in a separate
      // transaction. If it never got past 'pending' (e.g. the authorization
      // recheck itself failed), clean up the orphaned row.
      await supabase.from('refunds').delete().eq('id', inserted.id).eq('status', 'pending')
    }
    return result
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'payment.refund_requested',
    targetType: 'payment',
    targetId: inserted.id,
    summary: `Requested a ${input.refundMethod === 'paystack_reversal' ? 'Paystack' : 'bank transfer'} refund of ₦${Math.round(amount).toLocaleString('en-NG')} for approval`,
    metadata: { studentId: payment.student_id, paymentId: input.paymentId, amount, refundMethod: input.refundMethod },
  })

  revalidatePath('/money/refunds')
  return { success: true }
}

export async function approveRefund(refundId: string): Promise<ActionResult> {
  // M2: approving a refund moves money — gate on billing.
  const billingGate = await requireBillingActiveOrError()
  if (billingGate) return billingGate
  const ctx = await requirePermission('approve-refunds')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const gate = await featureGateError(ctx)
  if (gate) return { error: gate }

  const { data: refund } = await ctx.supabase
    .from('refunds')
    .select('id, payment_id, student_id, amount, refund_method, refund_reference, requested_by, requested_by_name, status')
    .eq('id', refundId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!refund) return { error: 'That refund request could not be found.' }
  if (refund.status !== 'pending') return { error: 'This request has already been resolved.' }

  return applyApprovedRefund(ctx, refund as RefundRow, false)
}

// Confirms a refund/chargeback the Paystack webhook DETECTED (not requested
// through Fees101 at all — a refund made directly on Paystack's dashboard, or
// a lost chargeback dispute) actually happened, and only THEN writes the
// ledger adjustment (confirm_external_refund). No liability-gate check here —
// this isn't requesting a NEW refund, it's acknowledging money that already
// left regardless of what Fees101 thinks, so gating it the same way would
// just delay the books from matching reality.
export async function confirmExternalRefund(refundId: string): Promise<ActionResult> {
  const billingGate = await requireBillingActiveOrError()
  if (billingGate) return billingGate
  const ctx = await requirePermission('approve-refunds')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const { data: refund } = await ctx.supabase
    .from('refunds')
    .select('id, amount, student_id, status, initiated_externally')
    .eq('id', refundId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!refund) return { error: 'That item could not be found.' }
  if (!refund.initiated_externally) return { error: 'This was requested through Fees101 — use the normal approve action.' }
  if (refund.status !== 'pending') return { error: 'This has already been resolved.' }

  const { error } = await ctx.supabase.rpc('confirm_external_refund', {
    p_refund_id: refundId,
    p_school_id: ctx.schoolId,
    p_reviewer_id: ctx.userId,
  })
  if (error) return { error: friendlyWriteError(error, 'That could not be confirmed.') }

  await finalizeCompletedRefund(ctx.supabase, refundId)

  await logAuditEvent(ctx.supabase, {
    schoolId: ctx.schoolId,
    actorId: ctx.userId,
    action: 'payment.external_refund_confirmed',
    targetType: 'payment',
    targetId: refundId,
    summary: `Confirmed a ₦${Math.round(Number(refund.amount)).toLocaleString('en-NG')} refund/chargeback that happened directly on Paystack`,
    metadata: { studentId: refund.student_id, amount: Number(refund.amount) },
  })

  revalidatePath('/money/refunds')
  return { success: true }
}

export async function rejectRefund(refundId: string, reviewNote: string): Promise<ActionResult> {
  const ctx = await requirePermission('approve-refunds')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const gate = await featureGateError(ctx)
  if (gate) return { error: gate }

  if (!reviewNote.trim()) return { error: 'A reason is required to reject.' }

  const { supabase, schoolId, userId } = ctx
  const { data: refund } = await supabase
    .from('refunds')
    .select('id, amount, student_id, status, refund_method')
    .eq('id', refundId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!refund) return { error: 'That refund request could not be found.' }
  if (refund.status !== 'pending') return { error: 'This request has already been resolved.' }

  const reviewerName = await actorName(ctx)
  const { error } = await supabase
    .from('refunds')
    .update({
      status: 'rejected',
      approved_by: userId,
      approved_by_name: reviewerName,
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reviewNote.trim(),
    })
    .eq('id', refundId)
    .eq('status', 'pending')
  if (error) return { error: friendlyWriteError(error, 'That could not be saved.') }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'payment.refund_rejected',
    targetType: 'payment',
    targetId: refundId,
    summary: `Rejected a refund request of ₦${Math.round(Number(refund.amount)).toLocaleString('en-NG')}`,
    metadata: { studentId: refund.student_id, amount: Number(refund.amount), reason: reviewNote.trim() },
  })

  revalidatePath('/money/refunds')
  return { success: true }
}

export async function acceptRefundsLiability(accepted: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }
  if (!ctx.isOwner) return { error: 'Only the school owner can accept this.' }
  if (!accepted) return { error: 'You must accept the responsibility note to continue.' }

  const { error } = await ctx.supabase
    .from('schools')
    .update({
      refunds_liability_version: REFUNDS_LIABILITY_VERSION,
      refunds_liability_accepted_at: new Date().toISOString(),
      refunds_liability_accepted_by: ctx.userId,
    })
    .eq('id', ctx.schoolId)
  if (error) return { error: error.message }

  await logAuditEvent(ctx.supabase, {
    schoolId: ctx.schoolId,
    actorId: ctx.userId,
    action: 'payment.refund_liability_accepted',
    targetType: 'school',
    targetId: ctx.schoolId,
    summary: 'Accepted the refunds responsibility note',
    metadata: { version: REFUNDS_LIABILITY_VERSION },
  })

  revalidatePath('/money/refunds')
  return { success: true }
}
