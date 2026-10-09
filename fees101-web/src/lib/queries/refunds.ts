import { getAuthContext } from '@/lib/auth/permissions'
import { REFUNDS_LIABILITY_VERSION } from '@/lib/platformBilling/config'
import type { PendingRefund, DecidedRefund } from '@/lib/refunds/display'

export {
  refundMethodLabel,
  refundCategoryLabel,
} from '@/lib/refunds/display'
export type { PendingRefund, DecidedRefund, RefundablePayment } from '@/lib/refunds/display'

export interface RefundsFeatureState {
  // Self-serve (2026-10-09): every school can use refunds once its owner
  // accepts the liability affirmation below — no per-school console toggle.
  // False when it was never accepted, or accepted against an older version
  // that has since changed.
  liabilityAccepted: boolean
  acceptedVersion: string | null
  currentVersion: string
}

async function getSchoolContext() {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId }
}

export async function getRefundsFeatureState(): Promise<RefundsFeatureState> {
  const base: RefundsFeatureState = {
    liabilityAccepted: false,
    acceptedVersion: null,
    currentVersion: REFUNDS_LIABILITY_VERSION,
  }
  const sc = await getSchoolContext()
  if (!sc) return base

  const { data } = await sc.supabase
    .from('schools')
    .select('refunds_liability_version')
    .eq('id', sc.schoolId)
    .maybeSingle()

  const acceptedVersion = (data?.refunds_liability_version as string | null) ?? null
  return {
    liabilityAccepted: acceptedVersion === REFUNDS_LIABILITY_VERSION,
    acceptedVersion,
    currentVersion: REFUNDS_LIABILITY_VERSION,
  }
}

function studentName(row: any): string {
  const s = row?.students
  return `${s?.first_name || ''} ${s?.last_name || ''}`.trim() || 'Unknown student'
}

function className(row: any): string {
  return row?.students?.classes?.name || ''
}

function cycleName(row: any): string | null {
  return row?.invoices?.billing_cycles?.name || null
}

function paymentPaidAt(row: any): string | null {
  return row?.payments?.paid_at || null
}

const ROW_SELECT =
  'id, student_id, payment_id, invoice_id, amount, category, reason, refund_method, refund_reference, ' +
  'status, auto_approved, requested_by_name, requested_at, approved_by_name, approved_at, ' +
  'rejection_reason, failure_reason, processed_at, paystack_refund_id, initiated_externally, ' +
  'students(first_name, last_name, classes(name)), ' +
  'invoices(billing_cycles(name)), ' +
  // Explicit FK hint (!payment_id) — refunds has two FKs into payments
  // (payment_id and reversal_payment_id), so a bare `payments(...)` embed is
  // ambiguous to PostgREST.
  'payments!payment_id(paid_at)'

export interface PendingRefundsResult {
  pending: PendingRefund[]
  // Naira total of the full pending set "if all approved" — computed here
  // from its own narrow query rather than the client reducing the (currently
  // unpaginated) `pending` array, so the figure stays correct if a limit is
  // ever added to the row fetch above.
  total: number
}

export async function getPendingRefunds(): Promise<PendingRefundsResult> {
  const sc = await getSchoolContext()
  if (!sc) return { pending: [], total: 0 }

  const [{ data }, { data: amounts }] = await Promise.all([
    sc.supabase
      .from('refunds')
      .select(ROW_SELECT)
      .eq('school_id', sc.schoolId)
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    sc.supabase
      .from('refunds')
      .select('amount')
      .eq('school_id', sc.schoolId)
      .eq('status', 'pending'),
  ])

  const pending = (data || []).map((r: any) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: studentName(r),
    className: className(r),
    paymentId: r.payment_id,
    invoiceId: r.invoice_id,
    cycleName: cycleName(r),
    paymentPaidAt: paymentPaidAt(r),
    amount: Number(r.amount),
    category: r.category,
    reason: r.reason,
    refundMethod: r.refund_method,
    refundReference: r.refund_reference,
    requestedByName: r.requested_by_name,
    requestedAt: r.requested_at,
    initiatedExternally: r.initiated_externally === true,
  }))

  const total = (amounts || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)

  return { pending, total }
}

export async function getDecidedRefunds(limit = 50): Promise<DecidedRefund[]> {
  const sc = await getSchoolContext()
  if (!sc) return []

  const { data } = await sc.supabase
    .from('refunds')
    .select(ROW_SELECT)
    .eq('school_id', sc.schoolId)
    .neq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(limit)

  return (data || []).map((r: any) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: studentName(r),
    className: className(r),
    paymentId: r.payment_id,
    invoiceId: r.invoice_id,
    cycleName: cycleName(r),
    paymentPaidAt: paymentPaidAt(r),
    amount: Number(r.amount),
    category: r.category,
    reason: r.reason,
    refundMethod: r.refund_method,
    refundReference: r.refund_reference,
    status: r.status,
    autoApproved: r.auto_approved === true,
    requestedByName: r.requested_by_name,
    requestedAt: r.requested_at,
    approvedByName: r.approved_by_name,
    approvedAt: r.approved_at,
    rejectionReason: r.rejection_reason,
    failureReason: r.failure_reason,
    processedAt: r.processed_at,
    paystackRefundId: r.paystack_refund_id,
    initiatedExternally: r.initiated_externally === true,
  }))
}

// The refundable remainder on a specific payment — its own amount minus
// whatever's already completed/processing against it. Used by the "Refund
// this payment" entry point to validate/prefill before opening the drawer.
export async function getRefundableAmount(paymentId: string): Promise<number | null> {
  const sc = await getSchoolContext()
  if (!sc) return null

  const { data: payment } = await sc.supabase
    .from('payments')
    .select('amount, provider, school_id')
    .eq('id', paymentId)
    .eq('school_id', sc.schoolId)
    .maybeSingle()
  if (!payment || !payment.provider) return null

  const { data: existing } = await sc.supabase
    .from('refunds')
    .select('amount')
    .eq('payment_id', paymentId)
    .in('status', ['completed', 'processing'])

  const alreadyRefunded = (existing || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)
  return Math.max(Number(payment.amount) - alreadyRefunded, 0)
}
