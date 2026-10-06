'use server'

import { revalidatePath } from 'next/cache'
import { getAuthContext, requirePermission, type AuthContext } from '@/lib/auth/permissions'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { MANUAL_PAYMENT_LIABILITY_VERSION } from '@/lib/platformBilling/config'
import { requireBillingActive } from '@/lib/platformBilling/requireBillingActive'
import { sendManualPaymentReceipt, sendManualPaymentCorrection } from '@/lib/payments/manualPaymentNotify'
import { friendlyWriteError } from '@/lib/errors/friendlyWriteError'

// Manual payment entry — server actions. School staff record a cash/POS/cheque
// payment that never came through the automated pipeline; it is applied to the
// ledger either immediately (owner) or after an approver signs off. A mistake
// is corrected with an audited reversal, never an in-place edit.
//
// Every write re-checks the permission AND the feature gate (enabled by the
// console, liability accepted by the owner) server-side, independent of what
// the page chose to render.

const METHODS = new Set(['cash', 'pos', 'cheque', 'other'])
// A manual entry must carry a real reference as proof it happened (a teller/POS/
// cheque number or the parent's bank-notification id), and a reversal must carry
// a real reason — both long enough to be meaningful, not a single junk character.
// Enforced server-side (here) for everyone, owner included, so it can't be
// bypassed from the client.
const MIN_REFERENCE_LENGTH = 3
const MIN_REVERSAL_REASON_LENGTH = 5
const DEPOSITS = new Set(['school_bank', 'paystack_dva', 'other'])

type ActionResult = { success: true } | { error: string }

// Money hygiene: a manual amount must be a positive number with at most two
// decimal places, and is rounded to 2dp before it is stored or applied so the
// invoice/credit waterfall and the reversal split never accumulate float drift.
function isValidMoney(n: number): boolean {
  return Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
}
function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

// Our approval RPCs raise plain, user-facing sentences. Surface that message
// directly when present, otherwise a generic fallback.
function rpcErrorMessage(err: { message?: string } | null | undefined, fallback: string): string {
  const m = (err?.message || '').trim()
  return m || fallback
}

// Resolves the signed-in staff member's display name for the stamped-on-row
// requested_by_name / reviewed_by_name (kept denormalised so the history reads
// correctly even if the user is later renamed or removed).
async function actorName(ctx: AuthContext): Promise<string> {
  const { data } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()
  return data?.name || 'Unknown user'
}

// The feature is usable only once Fees101 has enabled it for the school AND the
// owner has accepted the current liability affirmation. Returns an error string
// when it is not, or null when writes may proceed.
async function featureGateError(ctx: AuthContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from('schools')
    .select('manual_payment_entry_enabled, manual_payment_liability_version')
    .eq('id', ctx.schoolId)
    .maybeSingle()
  if (!data?.manual_payment_entry_enabled) {
    return 'Manual payment entry is not enabled for this school.'
  }
  if (data.manual_payment_liability_version !== MANUAL_PAYMENT_LIABILITY_VERSION) {
    return 'The school owner must accept the manual payment responsibility note before this can be used.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Read helpers for the record form (callable from the client component).
// ---------------------------------------------------------------------------

export interface ManualPaymentStudentOption {
  id: string
  name: string
  className: string
}

export async function searchManualPaymentStudents(query: string): Promise<ManualPaymentStudentOption[]> {
  const ctx = await requirePermission('record-manual-payments')
  if (!ctx || !ctx.schoolId) return []
  const q = (query || '').trim()
  if (q.length < 2) return []

  // Escape the PostgREST or-filter metacharacters so a name with a comma or a
  // percent sign can't break out of the ilike pattern.
  const safe = q.replace(/[,()%]/g, ' ').trim()
  if (!safe) return []

  const { data } = await ctx.supabase
    .from('students')
    .select('id, first_name, last_name, classes(name)')
    .eq('school_id', ctx.schoolId)
    .eq('status', 'active')
    .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`)
    .order('first_name', { ascending: true })
    .limit(20)

  return (data || []).map((s: any) => ({
    id: s.id,
    name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
    className: s.classes?.name || '',
  }))
}

export interface ManualPaymentInvoiceOption {
  id: string
  cycleName: string
  outstanding: number
  status: string
}

export async function getStudentOpenInvoices(studentId: string): Promise<ManualPaymentInvoiceOption[]> {
  const ctx = await requirePermission('record-manual-payments')
  if (!ctx || !ctx.schoolId) return []

  const { data } = await ctx.supabase
    .from('invoices')
    .select('id, outstanding_amount, status, billing_cycles(name, start_date)')
    .eq('school_id', ctx.schoolId)
    .eq('student_id', studentId)
    .neq('status', 'cancelled')
    .gt('outstanding_amount', 0)

  return (data || [])
    .map((inv: any) => ({
      id: inv.id,
      cycleName: inv.billing_cycles?.name || 'Invoice',
      outstanding: Number(inv.outstanding_amount),
      status: inv.status,
      _sort: inv.billing_cycles?.start_date || '',
    }))
    .sort((a: any, b: any) => a._sort.localeCompare(b._sort))
    .map(({ _sort, ...rest }: any) => rest)
}

// ---------------------------------------------------------------------------
// The shared approval path. The ledger work is done entirely inside a single
// SECURITY DEFINER transaction (approve_manual_payment_request /
// approve_manual_reversal_request) so an approval is all-or-nothing: a
// concurrent or retried call can never double-apply, and a mid-way failure can
// never leave a request 'approved' with no payment (or 'pending' with money
// already moved). The action only maps a clean error, logs the audit event, and
// sends the parent message AFTER the ledger has committed, so a send failure can
// never roll the ledger back.
// ---------------------------------------------------------------------------

interface RequestRow {
  id: string
  student_id: string
  invoice_id: string | null
  amount: number
  method: string
  deposit_reference: string | null
  notes: string | null
  requested_by: string
  requested_by_name: string
  requested_at: string
  reversal_of: string | null
}

async function applyApprovedManualPayment(
  ctx: AuthContext,
  req: RequestRow,
  auto: boolean,
): Promise<ActionResult> {
  const { supabase, schoolId, userId } = ctx

  if (req.reversal_of) {
    return applyApprovedReversal(ctx, req)
  }

  // Separation of duties mirror (the RPC enforces it too, this is just for a
  // clean message): an approver cannot approve an entry they recorded, unless
  // they are the owner (which is also the auto-approve path).
  if (!ctx.isOwner && req.requested_by === userId) {
    return { error: 'You cannot approve a manual payment you recorded yourself.' }
  }

  const amount = roundMoney(Number(req.amount))

  const { data, error } = await supabase
    .rpc('approve_manual_payment_request', {
      p_request_id: req.id,
      p_school_id: schoolId,
      p_reviewer_id: userId,
      p_auto: auto,
    })
    .single()
  if (error) return { error: rpcErrorMessage(error, 'Could not apply the payment.') }

  const row = data as any
  const primaryPaymentId: string | null = row?.payment_id || null
  const invoiceAmount = Number(row?.invoice_amount) || 0
  const creditAmount = Number(row?.credit_amount) || 0
  const newOutstanding = Number(row?.new_outstanding) || 0
  const isFull = row?.is_full === true

  await logAuditEvent(supabase, {
    schoolId: schoolId as string,
    actorId: userId,
    action: 'payment.manual_approved',
    targetType: 'payment',
    targetId: req.id,
    summary: auto
      ? `Recorded a manual ${req.method} payment of ₦${Math.round(amount).toLocaleString('en-NG')}`
      : `Approved a manual ${req.method} payment of ₦${Math.round(amount).toLocaleString('en-NG')}`,
    metadata: {
      studentId: req.student_id,
      invoiceId: req.invoice_id,
      amount,
      method: req.method,
      autoApproved: auto,
      paymentId: primaryPaymentId,
    },
  })

  await sendManualPaymentReceipt({
    supabase,
    schoolId: schoolId as string,
    studentId: req.student_id,
    invoiceId: req.invoice_id,
    invoiceAmount,
    isFull,
    newOutstanding,
    creditAmount,
    termName: null,
    paidAt: req.requested_at,
    reference: req.deposit_reference || primaryPaymentId || '',
  })

  return { success: true }
}

// INVARIANT: corrections only ever act on manual entries this feature recorded;
// provider/DVA payments are never editable here. A reversal references the
// ORIGINAL manual_payment_requests row (req.reversal_of), and the RPC undoes the
// money strictly from that original request's own payment_id, asserting that
// payment carries no provider before touching it.
async function applyApprovedReversal(
  ctx: AuthContext,
  req: RequestRow,
): Promise<ActionResult> {
  const { supabase, schoolId, userId } = ctx

  if (!ctx.isOwner && req.requested_by === userId) {
    return { error: 'You cannot approve a reversal you requested yourself.' }
  }

  const { data, error } = await supabase
    .rpc('approve_manual_reversal_request', {
      p_request_id: req.id,
      p_school_id: schoolId,
      p_reviewer_id: userId,
    })
    .single()
  if (error) return { error: rpcErrorMessage(error, 'Could not reverse the payment.') }

  const row = data as any
  const primaryPaymentId: string | null = row?.payment_id || null
  const amountReversed = Number(row?.amount_reversed) || 0
  const newOutstanding = row?.new_outstanding == null ? undefined : Number(row.new_outstanding)
  const studentId: string = row?.student_id
  const invoiceId: string | null = row?.invoice_id ?? null

  await logAuditEvent(supabase, {
    schoolId: schoolId as string,
    actorId: userId,
    action: 'payment.manual_reversed',
    targetType: 'payment',
    targetId: req.id,
    summary: `Reversed a manual payment of ₦${Math.round(amountReversed).toLocaleString('en-NG')}`,
    metadata: {
      studentId,
      invoiceId,
      originalRequestId: req.reversal_of,
      amountReversed,
      paymentId: primaryPaymentId,
    },
  })

  await sendManualPaymentCorrection({
    supabase,
    schoolId: schoolId as string,
    studentId,
    amountReversed,
    newOutstanding,
    reason: req.notes || undefined,
  })

  return { success: true }
}

// ---------------------------------------------------------------------------
// Public actions.
// ---------------------------------------------------------------------------

export interface RecordManualPaymentInput {
  studentId: string
  invoiceId?: string | null
  amount: number
  method: string
  depositedTo: string
  depositReference?: string
  notes?: string
}

export async function requestManualPayment(input: RecordManualPaymentInput): Promise<ActionResult> {
  // M2: recording money is core product use — gate on billing.
  await requireBillingActive()
  const ctx = await requirePermission('record-manual-payments')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const gate = await featureGateError(ctx)
  if (gate) return { error: gate }

  const rawAmount = Number(input.amount)
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return { error: 'Enter an amount greater than zero.' }
  if (!isValidMoney(rawAmount)) return { error: 'An amount can have at most two decimal places.' }
  const amount = roundMoney(rawAmount)
  if (!METHODS.has(input.method)) return { error: 'Choose how the payment was made.' }
  if (!DEPOSITS.has(input.depositedTo)) return { error: 'Choose where the money was deposited.' }
  if (!input.studentId) return { error: 'Choose a student.' }
  const depositReference = (input.depositReference || '').trim()
  if (depositReference.length < MIN_REFERENCE_LENGTH) {
    return { error: `Add a payment reference of at least ${MIN_REFERENCE_LENGTH} characters (a teller, POS, cheque or bank-notification number) as proof of the payment.` }
  }

  const { supabase, schoolId, userId } = ctx

  // The student (and invoice, if given) must belong to this school.
  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('id', input.studentId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!student) return { error: 'That student could not be found.' }

  let invoiceId: string | null = null
  if (input.invoiceId) {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('id')
      .eq('id', input.invoiceId)
      .eq('school_id', schoolId)
      .eq('student_id', input.studentId)
      .maybeSingle()
    if (!invoice) return { error: 'That invoice could not be found for this student.' }
    invoiceId = invoice.id
  }

  const requestedByName = await actorName(ctx)
  const isOwner = ctx.isOwner

  const { data: inserted, error } = await supabase
    .from('manual_payment_requests')
    .insert({
      school_id: schoolId,
      student_id: input.studentId,
      invoice_id: invoiceId,
      amount,
      method: input.method,
      deposited_to: input.depositedTo,
      deposit_reference: depositReference,
      notes: input.notes?.trim() || null,
      status: 'pending',
      requested_by: userId,
      requested_by_name: requestedByName,
    })
    .select('id, student_id, invoice_id, amount, method, deposit_reference, notes, requested_by, requested_by_name, requested_at, reversal_of')
    .single()
  if (error || !inserted) return { error: friendlyWriteError(error, 'Could not record the payment.') }

  // The owner has no one above them to approve, so their own entries apply
  // immediately — still through this table and the audit log, just auto-approved.
  if (isOwner) {
    const result = await applyApprovedManualPayment(ctx, inserted as RequestRow, true)
    // The insert committed in its own transaction; the apply runs in a separate
    // SECURITY DEFINER transaction that is all-or-nothing. If it rolled back, the
    // pending row is orphaned, so remove it (guarded to status='pending' so a row
    // that actually applied can never be deleted) before returning the error.
    if ('error' in result) {
      await supabase.from('manual_payment_requests').delete().eq('id', inserted.id).eq('status', 'pending')
    }
    revalidatePath('/discounts/manual-payments')
    return result
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'payment.manual_requested',
    targetType: 'payment',
    targetId: inserted.id,
    summary: `Recorded a manual ${input.method} payment of ₦${Math.round(amount).toLocaleString('en-NG')} for approval`,
    metadata: { studentId: input.studentId, invoiceId, amount, method: input.method },
  })

  revalidatePath('/discounts/manual-payments')
  return { success: true }
}

export async function approveManualPayment(requestId: string): Promise<ActionResult> {
  // M2: approving a payment posts money against an invoice — gate on billing.
  await requireBillingActive()
  const ctx = await requirePermission('approve-manual-payments')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const gate = await featureGateError(ctx)
  if (gate) return { error: gate }

  const { data: req } = await ctx.supabase
    .from('manual_payment_requests')
    .select('id, student_id, invoice_id, amount, method, deposit_reference, notes, requested_by, requested_by_name, requested_at, reversal_of, status')
    .eq('id', requestId)
    .eq('school_id', ctx.schoolId)
    .maybeSingle()
  if (!req) return { error: 'That request could not be found.' }
  if (req.status !== 'pending') return { error: 'This request has already been resolved.' }

  const result = await applyApprovedManualPayment(ctx, req as RequestRow, false)
  revalidatePath('/discounts/manual-payments')
  return result
}

export async function rejectManualPayment(requestId: string, reviewNote: string): Promise<ActionResult> {
  const ctx = await requirePermission('approve-manual-payments')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const gate = await featureGateError(ctx)
  if (gate) return { error: gate }

  if (!reviewNote.trim()) return { error: 'A reason is required to reject.' }

  const { supabase, schoolId, userId } = ctx
  const { data: req } = await supabase
    .from('manual_payment_requests')
    .select('id, amount, method, student_id, status, reversal_of')
    .eq('id', requestId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!req) return { error: 'That request could not be found.' }
  if (req.status !== 'pending') return { error: 'This request has already been resolved.' }

  const reviewerName = await actorName(ctx)
  const { error } = await supabase
    .from('manual_payment_requests')
    .update({
      status: 'rejected',
      reviewed_by: userId,
      reviewed_by_name: reviewerName,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote.trim(),
    })
    .eq('id', requestId)
    .eq('status', 'pending')
  if (error) return { error: friendlyWriteError(error, 'That could not be saved.') }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'payment.manual_rejected',
    targetType: 'payment',
    targetId: requestId,
    summary: req.reversal_of
      ? 'Rejected a manual payment reversal'
      : `Rejected a manual ${req.method} payment of ₦${Math.round(Number(req.amount)).toLocaleString('en-NG')}`,
    metadata: { studentId: req.student_id, amount: Number(req.amount), reason: reviewNote.trim() },
  })

  revalidatePath('/discounts/manual-payments')
  return { success: true }
}

// Raises a reversal of an already-approved entry. A reversal is itself a
// request that an approver signs off — it never auto-approves, not even for the
// owner, because undoing recorded money is exactly the action that warrants a
// second set of eyes.
//
// INVARIANT: corrections only ever act on manual entries this feature recorded;
// provider/DVA payments are never editable here. originalId references a
// manual_payment_requests row, and the reversal only ever acts on that row's own
// payment_id (asserted below to exist; the approval RPC re-asserts it carries no
// provider), so an automatically recorded payment can never be reversed here.
export async function requestReversal(originalId: string, reason: string): Promise<ActionResult> {
  const ctx = await requirePermission('approve-manual-payments')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }

  const gate = await featureGateError(ctx)
  if (gate) return { error: gate }

  if (reason.trim().length < MIN_REVERSAL_REASON_LENGTH) return { error: `Give a reason of at least ${MIN_REVERSAL_REASON_LENGTH} characters for the reversal, so there is a clear record of why.` }

  const { supabase, schoolId, userId } = ctx

  const { data: original } = await supabase
    .from('manual_payment_requests')
    .select('id, student_id, invoice_id, amount, method, deposited_to, status, reversal_of, payment_id')
    .eq('id', originalId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!original) return { error: 'That payment could not be found.' }
  if (original.status !== 'approved') return { error: 'Only an approved payment can be reversed.' }
  if (original.reversal_of) return { error: 'A reversal cannot itself be reversed.' }
  // A genuine manual entry always has its own ledger row; its absence means
  // there is nothing this feature recorded to correct.
  if (!original.payment_id) return { error: 'This payment has no recorded entry to reverse.' }

  // Guard against a second reversal of the same entry (already pending or done).
  const { data: existing } = await supabase
    .from('manual_payment_requests')
    .select('id, status')
    .eq('school_id', schoolId)
    .eq('reversal_of', originalId)
    .in('status', ['pending', 'approved'])
    .maybeSingle()
  if (existing) return { error: 'This payment already has a reversal in progress or applied.' }

  const requestedByName = await actorName(ctx)
  const { data: inserted, error } = await supabase
    .from('manual_payment_requests')
    .insert({
      school_id: schoolId,
      student_id: original.student_id,
      invoice_id: original.invoice_id,
      // The negated original — a reversal row always carries the opposite sign.
      amount: -roundMoney(Number(original.amount)),
      method: original.method,
      deposited_to: original.deposited_to,
      notes: reason.trim(),
      status: 'pending',
      requested_by: userId,
      requested_by_name: requestedByName,
      reversal_of: originalId,
    })
    .select('id, student_id, invoice_id, amount, method, deposit_reference, notes, requested_by, requested_by_name, requested_at, reversal_of')
    .single()
  if (error || !inserted) return { error: friendlyWriteError(error, 'Could not raise the reversal.') }

  // The owner is the final authority with no one above them to approve, so their
  // own reversal applies immediately — the same auto-approve the owner already
  // gets when recording a regular manual payment, kept consistent here. A
  // non-owner's reversal still waits for a second approver (separation of duties
  // is exactly what you want when undoing recorded money).
  if (ctx.isOwner) {
    const result = await applyApprovedReversal(ctx, inserted as RequestRow)
    // Same atomic guarantee as the record path: if the apply rolled back, delete
    // the orphaned pending reversal, which would otherwise linger AND trip the
    // one-active-reversal unique index so no retry could ever be raised.
    if ('error' in result) {
      await supabase.from('manual_payment_requests').delete().eq('id', inserted.id).eq('status', 'pending')
    }
    revalidatePath('/discounts/manual-payments')
    return result
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'payment.manual_requested',
    targetType: 'payment',
    targetId: inserted.id,
    summary: `Requested a reversal of a manual payment of ₦${Math.round(Number(original.amount)).toLocaleString('en-NG')}`,
    metadata: { studentId: original.student_id, originalRequestId: originalId, reason: reason.trim() },
  })

  revalidatePath('/discounts/manual-payments')
  return { success: true }
}

// Owner accepts the versioned liability affirmation, unlocking the feature for
// everyone with the permission. Stamped per version, so changing the text
// re-prompts for a fresh acceptance.
export async function acceptManualPaymentLiability(accepted: boolean): Promise<ActionResult> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }
  if (!ctx.isOwner) return { error: 'Only the school owner can accept this.' }
  if (!accepted) return { error: 'You must accept the responsibility note to continue.' }

  const { data: school } = await ctx.supabase
    .from('schools')
    .select('manual_payment_entry_enabled')
    .eq('id', ctx.schoolId)
    .maybeSingle()
  if (!school?.manual_payment_entry_enabled) {
    return { error: 'Manual payment entry is not enabled for this school yet.' }
  }

  const { error } = await ctx.supabase
    .from('schools')
    .update({
      manual_payment_liability_version: MANUAL_PAYMENT_LIABILITY_VERSION,
      manual_payment_liability_accepted_at: new Date().toISOString(),
      manual_payment_liability_accepted_by: ctx.userId,
    })
    .eq('id', ctx.schoolId)
  if (error) return { error: error.message }

  await logAuditEvent(ctx.supabase, {
    schoolId: ctx.schoolId,
    actorId: ctx.userId,
    action: 'payment.manual_requested',
    targetType: 'school',
    targetId: ctx.schoolId,
    summary: 'Accepted the manual payment responsibility note',
    metadata: { version: MANUAL_PAYMENT_LIABILITY_VERSION },
  })

  revalidatePath('/discounts/manual-payments')
  return { success: true }
}
