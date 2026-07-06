// Shared invoice-computation logic used both when generating/regenerating
// invoices (fees/cycles/actions.ts) and when checking whether an already
// generated invoice is stale relative to current fees/opt-ins (queries/fees.ts).

export interface ComputedLineItem {
  name: string
  amount: number
  kind: 'required' | 'opt_in' | 'previous_balance'
  fee_item_id?: string
}

export interface ComputedInvoice {
  studentId: string
  studentName: string
  className: string
  lineItems: ComputedLineItem[]
  subtotal: number
  previousBalance: number
  total: number
  warning?: string
}

// Compute what a student's invoice would look like for a given cycle
export async function computeInvoiceForStudent(
  supabase: any,
  schoolId: string,
  studentId: string,
  cycleId: string
): Promise<ComputedInvoice | { error: string }> {
  // Get student
  const { data: student } = await supabase
    .from('students')
    .select('id, first_name, last_name, class_id, status, classes(name)')
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
    .select('id, class_id, name, amount, is_mandatory, is_optional_extra')
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
        })
      }
    } else if (f.is_optional_extra && optInIds.has(f.id)) {
      lineItems.push({
        name: f.name,
        amount: Number(f.amount),
        kind: 'opt_in',
        fee_item_id: f.id,
      })
    }
  })

  // Carry-forward balance from most recent closed term
  let previousBalance = 0
  const { data: thisCycle } = await supabase
    .from('billing_cycles')
    .select('start_date')
    .eq('id', cycleId)
    .single()

  if (thisCycle) {
    const { data: priorClosedCycle } = await supabase
      .from('billing_cycles')
      .select('id, name')
      .eq('school_id', schoolId)
      .eq('status', 'closed')
      .lt('start_date', thisCycle.start_date)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (priorClosedCycle) {
      const { data: priorInvoice } = await supabase
        .from('invoices')
        .select('outstanding_amount, total_amount, paid_amount')
        .eq('student_id', studentId)
        .eq('billing_cycle_id', priorClosedCycle.id)
        .maybeSingle()

      if (priorInvoice) {
        const outstanding = Number(priorInvoice.outstanding_amount ?? (Number(priorInvoice.total_amount) - Number(priorInvoice.paid_amount || 0)))
        if (outstanding > 0) {
          previousBalance = outstanding
          lineItems.push({
            name: `Outstanding balance from ${priorClosedCycle.name}`,
            amount: outstanding,
            kind: 'previous_balance',
          })
        }
      }
    }
  }

  const subtotal = lineItems.filter(li => li.kind !== 'previous_balance').reduce((s, li) => s + li.amount, 0)
  const total = subtotal + previousBalance

  return {
    studentId,
    studentName,
    className,
    lineItems,
    subtotal,
    previousBalance,
    total,
  }
}
