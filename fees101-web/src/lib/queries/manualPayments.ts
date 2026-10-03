import { getAuthContext } from '@/lib/auth/permissions'
import { MANUAL_PAYMENT_LIABILITY_VERSION } from '@/lib/platformBilling/config'
import type { PendingManualPayment, DecidedManualPayment } from '@/lib/manualPayments/display'

// Read side of the manual payment entry feature: the per-school feature/
// liability state the pages gate on, plus the pending queue and decided
// history that the workspace renders. All reads go through the user-scoped
// client, so RLS already limits them to the caller's own school.
//
// The client-safe label helpers and row shapes live in @/lib/manualPayments/
// display (no server imports) so the client workspace can use them without
// pulling this server-only module into the browser bundle. Re-exported here so
// existing server-side importers keep working.
export {
  manualPaymentMethodLabel,
  manualPaymentDepositLabel,
} from '@/lib/manualPayments/display'
export type { PendingManualPayment, DecidedManualPayment } from '@/lib/manualPayments/display'

export interface ManualPaymentFeatureState {
  // Fees101 staff turned the feature on for this school from the console.
  enabled: boolean
  // The owner has accepted the current liability affirmation. False when it was
  // never accepted, or accepted against an older version that has since changed.
  liabilityAccepted: boolean
  // The version the owner last accepted, for display. Null if never accepted.
  acceptedVersion: string | null
  // The version the owner is being asked to accept right now.
  currentVersion: string
}

async function getSchoolContext() {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId }
}

export async function getManualPaymentFeatureState(): Promise<ManualPaymentFeatureState> {
  const base: ManualPaymentFeatureState = {
    enabled: false,
    liabilityAccepted: false,
    acceptedVersion: null,
    currentVersion: MANUAL_PAYMENT_LIABILITY_VERSION,
  }
  const sc = await getSchoolContext()
  if (!sc) return base

  const { data } = await sc.supabase
    .from('schools')
    .select('manual_payment_entry_enabled, manual_payment_liability_version')
    .eq('id', sc.schoolId)
    .maybeSingle()

  const acceptedVersion = (data?.manual_payment_liability_version as string | null) ?? null
  return {
    enabled: data?.manual_payment_entry_enabled === true,
    liabilityAccepted: acceptedVersion === MANUAL_PAYMENT_LIABILITY_VERSION,
    acceptedVersion,
    currentVersion: MANUAL_PAYMENT_LIABILITY_VERSION,
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

const ROW_SELECT =
  'id, student_id, invoice_id, amount, method, deposited_to, deposit_reference, notes, ' +
  'status, auto_approved, requested_by_name, requested_at, reviewed_by_name, reviewed_at, ' +
  'review_note, reversal_of, payment_id, ' +
  'students(first_name, last_name, classes(name)), ' +
  'invoices(billing_cycles(name))'

export async function getPendingManualPayments(): Promise<PendingManualPayment[]> {
  const sc = await getSchoolContext()
  if (!sc) return []

  const { data } = await sc.supabase
    .from('manual_payment_requests')
    .select(ROW_SELECT)
    .eq('school_id', sc.schoolId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })

  return (data || []).map((r: any) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: studentName(r),
    className: className(r),
    invoiceId: r.invoice_id,
    cycleName: cycleName(r),
    amount: Number(r.amount),
    method: r.method,
    depositedTo: r.deposited_to,
    depositReference: r.deposit_reference,
    notes: r.notes,
    requestedByName: r.requested_by_name,
    requestedAt: r.requested_at,
    isReversal: !!r.reversal_of,
  }))
}

export async function getDecidedManualPayments(limit = 50): Promise<DecidedManualPayment[]> {
  const sc = await getSchoolContext()
  if (!sc) return []

  const { data } = await sc.supabase
    .from('manual_payment_requests')
    .select(ROW_SELECT)
    .eq('school_id', sc.schoolId)
    .neq('status', 'pending')
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .order('requested_at', { ascending: false })
    .limit(limit)

  const rows = data || []

  // An approved entry that a later approved reversal points back at is shown as
  // reversed, so the history doesn't keep offering to reverse something that is
  // already cancelled out.
  const reversedOriginalIds = new Set<string>(
    rows
      .filter((r: any) => r.reversal_of && r.status === 'approved')
      .map((r: any) => r.reversal_of as string),
  )

  return rows.map((r: any) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: studentName(r),
    className: className(r),
    invoiceId: r.invoice_id,
    cycleName: cycleName(r),
    amount: Number(r.amount),
    method: r.method,
    depositedTo: r.deposited_to,
    depositReference: r.deposit_reference,
    notes: r.notes,
    status: r.status,
    autoApproved: r.auto_approved === true,
    requestedByName: r.requested_by_name,
    requestedAt: r.requested_at,
    reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
    isReversal: !!r.reversal_of,
    reversed: reversedOriginalIds.has(r.id),
    paymentId: r.payment_id,
  }))
}
