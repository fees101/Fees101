import { getAuthContext } from '@/lib/auth/permissions'

export interface PendingDiscountRequest {
  id: string
  invoiceId: string
  studentId: string
  studentName: string
  className: string
  cycleName: string
  category: string
  amount: number
  isPercentage: boolean
  isRecurring: boolean
  reason: string
  requestedByName: string | null
  requestedAt: string
  invoiceSubtotal: number
  existingDiscountAmount: number
}

// A request someone has already decided — shown below the pending ones in the
// Queue so a decision doesn't disappear the moment it's made. 'applied' is the
// approved state (recordApplied/approveDiscount writes that status, not
// 'approved' — see src/app/(app)/discounts/actions.ts). 'revoked' is derived,
// not a raw status column value — see db/discounts_revoked.sql: a discount
// keeps its underlying status ('applied' if only its carry-forward was
// stopped, 'rejected' if it was fully lifted off an unsent/unpaid invoice)
// and revoked_at/revoked_by are stamped alongside it, so "revoked" can be
// told apart from "was never approved" or "still active".
export interface DecidedDiscountRequest {
  id: string
  invoiceId: string
  studentId: string
  studentName: string
  className: string
  cycleName: string
  category: string
  amount: number
  isPercentage: boolean
  isRecurring: boolean
  reason: string
  status: 'applied' | 'rejected' | 'revoked'
  decidedByName: string | null
  decidedAt: string
  rejectionReason: string | null
  // Whether this row can still be revoked from the Queue (currently active:
  // approved/applied and not already revoked). Sibling discounts are
  // auto-applied and excluded — see revokeActiveDiscount.
  canRevoke: boolean
}

async function getSchoolContext() {
  const ctx = await getAuthContext()
  if (!ctx) return null
  const { supabase, schoolId, role } = ctx
  if (!schoolId) return null
  return { supabase, schoolId, role }
}

export interface ActiveRecurringDiscount {
  id: string
  studentId: string
  studentName: string
  className: string
  category: string
  amount: number
  isPercentage: boolean
  approvedAt: string | null
  // This term's fee subtotal (mandatory + opted-in, before discount) for the
  // student's active-cycle invoice — the same figure a percentage discount is
  // computed against at generation time (src/lib/discounts/compute.ts). Null
  // when the student has no invoice yet for the active cycle (or there is no
  // active cycle), meaning a percentage discount's naira cost isn't knowable yet.
  currentTermSubtotal: number | null
}

export async function getPendingDiscountRequests(): Promise<PendingDiscountRequest[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

  const { data } = await supabase
    .from('discounts')
    .select(`
      id, invoice_id, student_id, category, amount, is_percentage, is_recurring, reason, requested_at,
      students!inner(first_name, last_name, classes(name)),
      invoices!inner(subtotal, discount_amount, billing_cycles(name)),
      requested_by_user:users!discounts_requested_by_fkey(name)
    `)
    .eq('school_id', schoolId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })

  return (data || []).map((row: any) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    studentId: row.student_id,
    studentName: `${row.students?.first_name || ''} ${row.students?.last_name || ''}`.trim(),
    className: row.students?.classes?.name || '',
    cycleName: row.invoices?.billing_cycles?.name || '',
    category: row.category,
    amount: Number(row.amount),
    isPercentage: row.is_percentage,
    isRecurring: row.is_recurring,
    reason: row.reason,
    requestedByName: row.requested_by_user?.name || null,
    requestedAt: row.requested_at,
    invoiceSubtotal: Number(row.invoices?.subtotal || 0),
    existingDiscountAmount: Number(row.invoices?.discount_amount || 0),
  }))
}

// Recently decided requests — approved or denied — shown below the pending
// ones so a decision stays visible instead of vanishing from the Queue the
// moment it's made. Capped at 20; this is a recency window, not a full
// history (see /team/audit-log for the permanent record).
const DECIDED_HISTORY_LIMIT = 20

export async function getRecentDecidedDiscountRequests(): Promise<DecidedDiscountRequest[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

  const { data } = await supabase
    .from('discounts')
    .select(`
      id, invoice_id, student_id, category, amount, is_percentage, is_recurring, reason, status,
      approved_at, rejected_at, rejection_reason, revoked_at,
      students!inner(first_name, last_name, classes(name)),
      invoices!inner(billing_cycles(name)),
      approved_by_user:users!discounts_approved_by_fkey(name),
      rejected_by_user:users!discounts_rejected_by_fkey(name),
      revoked_by_user:users!discounts_revoked_by_fkey(name)
    `)
    .eq('school_id', schoolId)
    .in('status', ['applied', 'rejected'])
    // Manually requested only — an auto-applied rule (e.g. sibling_discount)
    // is inserted straight to 'applied' with no requested_by and never passed
    // through a Decide button, so it doesn't belong in this decision history.
    .not('requested_by', 'is', null)
    .order('requested_at', { ascending: false })
    .limit(DECIDED_HISTORY_LIMIT * 2)

  return (data || [])
    .map((row: any) => {
      const revoked = !!row.revoked_at
      const status: 'applied' | 'rejected' | 'revoked' = revoked ? 'revoked' : row.status
      return {
        id: row.id,
        invoiceId: row.invoice_id,
        studentId: row.student_id,
        studentName: `${row.students?.first_name || ''} ${row.students?.last_name || ''}`.trim(),
        className: row.students?.classes?.name || '',
        cycleName: row.invoices?.billing_cycles?.name || '',
        category: row.category,
        amount: Number(row.amount),
        isPercentage: row.is_percentage,
        isRecurring: row.is_recurring,
        reason: row.reason,
        status,
        decidedByName: (revoked ? row.revoked_by_user?.name : row.status === 'applied' ? row.approved_by_user?.name : row.rejected_by_user?.name) || null,
        decidedAt: (revoked ? row.revoked_at : row.status === 'applied' ? row.approved_at : row.rejected_at) || '',
        rejectionReason: row.rejection_reason || null,
        canRevoke: row.status === 'applied' && !revoked && row.category !== 'sibling_discount',
      }
    })
    .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))
    .slice(0, DECIDED_HISTORY_LIMIT)
}

// Recurring discounts (e.g. staff-child) that are still carrying forward
// automatically to each new invoice — this is the "who's currently getting
// one" list an admin needs in order to revoke one (e.g. staff member leaves).
// One row shown per student+category (the most recently approved), mirroring
// how src/lib/discounts/compute.ts:getRecurringDiscounts picks which row wins
// at generation time.
export async function getActiveRecurringDiscounts(): Promise<ActiveRecurringDiscount[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

  const { data } = await supabase
    .from('discounts')
    .select(`
      id, student_id, category, amount, is_percentage, approved_at, created_at,
      students!inner(first_name, last_name, classes(name))
    `)
    .eq('school_id', schoolId)
    .eq('is_recurring', true)
    .in('status', ['approved', 'applied'])
    .order('created_at', { ascending: false })

  const seen = new Set<string>()
  const latestPerStudentCategory: any[] = []
  for (const row of data || []) {
    const key = `${row.student_id}:${row.category}`
    if (seen.has(key)) continue
    seen.add(key)
    latestPerStudentCategory.push(row)
  }

  // A percentage discount's naira cost only exists against the student's
  // current-term fee subtotal, so resolve it here with a same-tables,
  // read-only join (active cycle -> that student's invoice subtotal) rather
  // than showing the bare rule with no ₦ figure.
  const subtotalByStudent = new Map<string, number>()
  const studentIds = [...new Set(latestPerStudentCategory.map(row => row.student_id))]
  if (studentIds.length > 0) {
    const { data: activeCycle } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .maybeSingle()

    if (activeCycle) {
      const { data: invoiceRows } = await supabase
        .from('invoices')
        .select('student_id, subtotal')
        .eq('billing_cycle_id', activeCycle.id)
        .in('student_id', studentIds)

      for (const row of invoiceRows || []) {
        subtotalByStudent.set(row.student_id, Number(row.subtotal))
      }
    }
  }

  return latestPerStudentCategory.map((row: any) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: `${row.students?.first_name || ''} ${row.students?.last_name || ''}`.trim(),
    className: row.students?.classes?.name || '',
    category: row.category,
    amount: Number(row.amount),
    isPercentage: row.is_percentage,
    approvedAt: row.approved_at,
    currentTermSubtotal: subtotalByStudent.get(row.student_id) ?? null,
  }))
}

