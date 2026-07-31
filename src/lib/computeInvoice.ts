// Shared invoice-computation logic used both when generating/regenerating
// invoices (fees/cycles/actions.ts) and when checking whether an already
// generated invoice is stale relative to current fees/opt-ins (queries/fees.ts).

import { computeDiscountsForInvoice, type AppliedDiscount } from '@/lib/discounts/compute'
import { getDiscountSettingsFor } from '@/lib/queries/discounts'

export interface ComputedLineItem {
  name: string
  amount: number
  kind: 'required' | 'opt_in' | 'previous_balance' | 'credit_applied'
  fee_item_id?: string
  // Whether this line item counts toward the base that % discounts are
  // computed against — false for fee items a school has marked non-discountable
  // (e.g. exam fees, uniforms), so a sibling/staff discount only ever
  // reduces the fees the school chose to make discountable, not everything.
  discountable?: boolean
}

export interface ComputedInvoice {
  studentId: string
  studentName: string
  className: string
  lineItems: ComputedLineItem[]
  subtotal: number
  previousBalance: number
  previousInvoiceId: string | null
  discountAmount: number
  discountReason: string
  appliedDiscounts: AppliedDiscount[]
  creditApplied: number
  total: number
  warning?: string
}

// Compute what a student's invoice would look like for a given cycle.
//
// creditBalanceOverride: use this instead of the student's live
// credit_balance. Needed for read-only staleness comparisons — an existing
// invoice's own credit_applied has already been subtracted out of the live
// balance, so comparing against the live balance directly would always
// disagree with what's stored, forever, on every single check. Pass
// (liveBalance + thisInvoice.creditApplied) to see what the invoice would
// look like if regenerated right now, without actually touching the DB.
//
// alreadyPaidAmount: the invoice's own current paid_amount (0 for a brand
// new invoice). Credit must never be applied beyond what's actually still
// unpaid after direct payments — otherwise regenerating an invoice that's
// already been fully settled by a real transfer can silently consume a
// family's prepaid credit for no reason, on a bill that never needed it.
export async function computeInvoiceForStudent(
  supabase: any,
  schoolId: string,
  studentId: string,
  cycleId: string,
  creditBalanceOverride?: number,
  alreadyPaidAmount: number = 0,
  existingInvoiceId?: string
): Promise<ComputedInvoice | { error: string }> {
  // Get student
  const { data: student } = await supabase
    .from('students')
    .select('id, first_name, last_name, class_id, family_id, status, credit_balance, classes(name)')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!student) return { error: 'Student not found' }
  if (student.status !== 'active') return { error: `Student is ${student.status}, not active` }

  const studentName = `${student.first_name} ${student.last_name}`
  const className: string = student.classes?.name || ''

  // Fee items: per-class for this student's class + school-wide
  let feeItemsQuery = supabase
    .from('fee_items')
    .select('id, class_id, name, amount, is_mandatory, is_optional_extra, is_discountable')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycleId)

  if (student.class_id) {
    feeItemsQuery = feeItemsQuery.or(`class_id.eq.${student.class_id},class_id.is.null`)
  } else {
    feeItemsQuery = feeItemsQuery.is('class_id', null)
  }

  const { data: feeItems } = await feeItemsQuery
  if (!feeItems || feeItems.length === 0) {
    return {
      studentId,
      studentName,
      className,
      lineItems: [],
      subtotal: 0,
      previousBalance: 0,
      previousInvoiceId: null,
      discountAmount: 0,
      discountReason: '',
      appliedDiscounts: [],
      creditApplied: 0,
      total: 0,
      warning: 'No fees configured for this term',
    }
  }

  // Adjustments
  const { data: adjustments } = await supabase
    .from('student_fee_adjustments')
    .select('fee_item_id, adjustment_type')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)

  const optInIds = new Set((adjustments || []).filter((a: any) => a.adjustment_type === 'opt_in').map((a: any) => a.fee_item_id))
  const exemptIds = new Set((adjustments || []).filter((a: any) => a.adjustment_type === 'exempt').map((a: any) => a.fee_item_id))

  const lineItems: ComputedLineItem[] = []

  feeItems.forEach((f: any) => {
    if (f.is_mandatory) {
      if (!exemptIds.has(f.id)) {
        lineItems.push({
          name: f.name,
          amount: Number(f.amount),
          kind: 'required',
          fee_item_id: f.id,
          discountable: f.is_discountable !== false,
        })
      }
    } else if (f.is_optional_extra && optInIds.has(f.id)) {
      lineItems.push({
        name: f.name,
        amount: Number(f.amount),
        kind: 'opt_in',
        fee_item_id: f.id,
        discountable: f.is_discountable !== false,
      })
    }
  })

  // Carry-forward balance from the immediately preceding term — and only
  // once that term is actually closed. This must be the cycle truly
  // adjacent by start_date, not just "the nearest closed cycle": reaching
  // past a still-open preceding cycle to an older closed one would
  // double-count debt that's already been folded into the open cycle's own
  // invoice total (from when *it* was carried forward). Until the
  // immediately preceding cycle is closed, there's nothing new to carry —
  // its own invoice is still the live record of what's owed for it.
  // Draft cycles are excluded from this lookup: a term prepared ahead of time
  // may carry a start_date that interleaves between the real closed prior term
  // and this one, and it has no billing history of its own — letting it be the
  // "preceding cycle" would silently zero out a legitimate carry-forward.
  let previousBalance = 0
  let previousInvoiceId: string | null = null
  const { data: thisCycle } = await supabase
    .from('billing_cycles')
    .select('start_date')
    .eq('id', cycleId)
    .single()

  if (thisCycle) {
    const { data: precedingCycle } = await supabase
      .from('billing_cycles')
      .select('id, name, status')
      .eq('school_id', schoolId)
      .lt('start_date', thisCycle.start_date)
      .neq('status', 'draft')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (precedingCycle && precedingCycle.status === 'closed') {
      const { data: priorInvoice } = await supabase
        .from('invoices')
        .select('id, outstanding_amount, total_amount, paid_amount')
        .eq('student_id', studentId)
        .eq('billing_cycle_id', precedingCycle.id)
        .maybeSingle()

      if (priorInvoice) {
        const outstanding = Number(priorInvoice.outstanding_amount ?? (Number(priorInvoice.total_amount) - Number(priorInvoice.paid_amount || 0)))
        if (outstanding > 0) {
          previousBalance = outstanding
          previousInvoiceId = priorInvoice.id
          lineItems.push({
            name: `Outstanding balance from ${precedingCycle.name}`,
            amount: outstanding,
            kind: 'previous_balance',
          })
        }
      }
    }
  }

  const subtotal = lineItems.filter(li => li.kind !== 'previous_balance').reduce((s, li) => s + li.amount, 0)
  const discountableSubtotal = lineItems
    .filter(li => li.kind !== 'previous_balance' && li.discountable !== false)
    .reduce((s, li) => s + li.amount, 0)

  const discountSettings = await getDiscountSettingsFor(supabase, schoolId)
  const { discountAmount, discountReason, appliedDiscounts } = await computeDiscountsForInvoice(
    supabase,
    schoolId,
    { id: student.id, family_id: student.family_id },
    discountableSubtotal,
    discountSettings,
    existingInvoiceId
  )

  // Discount only reduces this term's own fees — previous balance carried
  // forward from a prior term is added back in full afterward, so a staff or
  // sibling discount never quietly writes down debt the parent already owed.
  const amountDue = Math.max(0, subtotal - discountAmount) + previousBalance

  // Spend down any available credit (e.g. from a prior overpayment) against
  // whatever's still actually unpaid on this term's charges — never against
  // the gross fee total, or an invoice already settled by a direct payment
  // would have credit misapplied to it for nothing. Never over-applies past
  // what's actually owed — leftover credit stays on the student for a
  // future invoice. This only computes the amount; the caller (whoever
  // persists the invoice) is responsible for actually decrementing
  // students.credit_balance, since this function also runs read-only for
  // previews/staleness checks.
  const availableCredit = creditBalanceOverride !== undefined
    ? creditBalanceOverride
    : Number(student.credit_balance || 0)
  const stillUnpaid = Math.max(0, amountDue - alreadyPaidAmount)
  const creditApplied = Math.min(availableCredit, stillUnpaid)
  if (creditApplied > 0) {
    lineItems.push({
      name: 'Credit balance applied',
      amount: -creditApplied,
      kind: 'credit_applied',
    })
  }

  const total = amountDue - creditApplied

  return {
    studentId,
    studentName,
    className,
    lineItems,
    subtotal,
    previousBalance,
    previousInvoiceId,
    discountAmount,
    discountReason,
    appliedDiscounts,
    creditApplied,
    total,
  }
}

// Actually spends/restores a student's credit_balance — call this only from
// code paths that persist an invoice, never from previews or staleness
// checks. Positive delta restores credit (e.g. undoing a prior application
// before recomputing on regenerate), negative delta spends it. Uses a DB
// function so the read-modify-write is atomic instead of racing a plain
// select-then-update from this client.
export async function applyCreditBalanceDelta(
  supabase: any,
  schoolId: string,
  studentId: string,
  delta: number
): Promise<void> {
  if (delta === 0) return
  await supabase.rpc('adjust_student_credit_balance', {
    p_student_id: studentId,
    p_school_id: schoolId,
    p_delta: delta,
  })
}
