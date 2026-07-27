import { createClient } from '@/lib/supabase/server'
import { computeInvoiceForStudent } from '@/lib/computeInvoice'

export async function getStudents(statusFilter: 'active' | 'withdrawn' | 'graduated' | 'all' = 'active') {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return {
    students: [],
    classes: [],
    currentTermName: '',
    classCount: 0,
    statusCounts: { active: 0, withdrawn: 0, graduated: 0, all: 0 },
    activeStatusFilter: statusFilter,
    paymentsConfigured: false,
    studentsWithoutDvaCount: 0,
  }

  // Get current billing cycle
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  // Get all classes for filter dropdown
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order')

  // Get status counts (always all statuses, regardless of filter)
  const { data: allStudentsForCount } = await supabase
    .from('students')
    .select('status')
    .eq('school_id', schoolId)

  const statusCounts = {
    active: allStudentsForCount?.filter(s => s.status === 'active').length || 0,
    withdrawn: allStudentsForCount?.filter(s => s.status === 'withdrawn').length || 0,
    graduated: allStudentsForCount?.filter(s => s.status === 'graduated').length || 0,
    all: allStudentsForCount?.length || 0,
  }

  // For the "some students have no payment account" banner — only relevant once
  // the school has connected a payment provider.
  const { data: schoolRow } = await supabase
    .from('schools')
    .select('payment_provider')
    .eq('id', schoolId)
    .single()
  const paymentsConfigured = !!schoolRow?.payment_provider

  const { count: studentsWithoutDvaCount } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .is('provider_dva_reference', null)

  // Get students with class and family info, filtered by status
  let studentsQuery = supabase
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      admission_number,
      status,
      classes!inner(id, name),
      families!inner(primary_parent_name, primary_parent_phone)
    `)
    .eq('school_id', schoolId)

  if (statusFilter !== 'all') {
    studentsQuery = studentsQuery.eq('status', statusFilter)
  }

  const { data: students } = await studentsQuery.order('last_name')

  if (!students) return {
    students: [],
    classes: classes || [],
    currentTermName: currentCycle?.name || '',
    classCount: classes?.length || 0,
    statusCounts,
    activeStatusFilter: statusFilter,
    paymentsConfigured,
    studentsWithoutDvaCount: studentsWithoutDvaCount || 0,
  }

  // Get invoices for current cycle
  const studentIds = students.map(s => s.id)
  const { data: invoices } = await supabase
    .from('invoices')
    .select('student_id, total_amount, paid_amount, credit_applied, status')
    .in('student_id', studentIds)
    .eq('billing_cycle_id', currentCycle?.id || '')

  // Merge invoice data into students
  const studentsWithStatus = students.map(student => {
    const invoice = invoices?.find(inv => inv.student_id === student.id)
    return {
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      admissionNumber: student.admission_number,
      status: student.status,
      // @ts-expect-error — joined object
      className: student.classes?.name || '',
      // @ts-expect-error — joined object
      classId: student.classes?.id || '',
      // @ts-expect-error — joined object
      parentName: student.families?.primary_parent_name || '',
      // @ts-expect-error — joined object
      parentPhone: student.families?.primary_parent_phone || '',
      // Net (post-credit) figures — matches the parent-facing invoice and the
      // school's own collection rule (a credit application isn't new money
      // collected this term, since it was already counted when the cash
      // first arrived). Showing the gross pre-credit total here would read
      // as "the school collected X" when X was never actually paid this
      // term, and would color "Paid" red (unpaid status) right next to a
      // large paid-looking number, which is exactly backwards. Credit is
      // surfaced separately via creditApplied instead of folded in here.
      invoiceTotal: invoice ? Number(invoice.total_amount) : 0,
      invoicePaid: invoice ? Number(invoice.paid_amount) : 0,
      creditApplied: invoice ? Number(invoice.credit_applied || 0) : 0,
      invoiceStatus: invoice?.status || 'no_invoice',
    }
  })

  return {
    students: studentsWithStatus,
    classes: classes || [],
    currentTermName: currentCycle?.name || '',
    classCount: classes?.length || 0,
    statusCounts,
    activeStatusFilter: statusFilter,
    paymentsConfigured,
    studentsWithoutDvaCount: studentsWithoutDvaCount || 0,
  }
}

export async function getStudentById(studentId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return null

  // Get student with class and family
  const { data: student } = await supabase
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      admission_number,
      admission_date,
      status,
      provider_dva_reference,
      provider_dva_account_number,
      provider_dva_bank_name,
      classes!inner(id, name),
      families!inner(
        id,
        primary_parent_name,
        primary_parent_phone,
        primary_parent_email,
        secondary_parent_name,
        secondary_parent_phone,
        secondary_parent_email,
        notes
      )
    `)
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!student) return null

  // Whether this school has a payment provider at all — drives the header's
  // virtual-account state (has account / can create / not configured).
  const { data: schoolRow } = await supabase
    .from('schools')
    .select('payment_provider')
    .eq('id', schoolId)
    .single()

  // Get current billing cycle
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  // Get current term invoice
  const { data: currentInvoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('student_id', studentId)
    .eq('billing_cycle_id', currentCycle?.id || '')
    .maybeSingle()

  // Get siblings (other students in same family)
  // @ts-expect-error — families is joined object
  const familyId = student.families?.id
  const { data: siblings } = await supabase
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      classes!inner(name)
    `)
    .eq('school_id', schoolId)
    .eq('family_id', familyId)
    .neq('id', studentId)
    .eq('status', 'active')

  // Get sibling invoice statuses for current term
  let siblingsWithStatus: Array<{
    id: string
    firstName: string
    lastName: string
    className: string
    invoiceStatus: string
  }> = []

  if (siblings && currentCycle) {
    const siblingIds = siblings.map(s => s.id)
    const { data: siblingInvoices } = await supabase
      .from('invoices')
      .select('student_id, status')
      .in('student_id', siblingIds)
      .eq('billing_cycle_id', currentCycle.id)

    siblingsWithStatus = siblings.map(sib => {
      const invoice = siblingInvoices?.find(inv => inv.student_id === sib.id)
      return {
        id: sib.id,
        firstName: sib.first_name,
        lastName: sib.last_name,
        // @ts-expect-error — joined object
        className: sib.classes?.name || '',
        invoiceStatus: invoice?.status || 'no_invoice',
      }
    })
  }

  // Get payment history for current term invoice
  let payments: any[] = []
  if (currentInvoice) {
    const { data: paymentData } = await supabase
      .from('payments')
      .select('id, amount, method, paid_at, provider_reference')
      .eq('invoice_id', currentInvoice.id)
      .eq('match_status', 'matched')
      .order('paid_at', { ascending: false })
    
    payments = paymentData || []
  }

  return {
    id: student.id,
    firstName: student.first_name,
    lastName: student.last_name,
    admissionNumber: student.admission_number,
    admissionDate: student.admission_date,
    status: student.status,
    // @ts-expect-error — joined object
    className: student.classes?.name || '',
    // @ts-expect-error — joined object
    classId: student.classes?.id || '',
    family: {
      // @ts-expect-error — joined object
      id: student.families?.id || '',
      // @ts-expect-error — joined object
      primaryParentName: student.families?.primary_parent_name || '',
      // @ts-expect-error — joined object
      primaryParentPhone: student.families?.primary_parent_phone || '',
      // @ts-expect-error — joined object
      primaryParentEmail: student.families?.primary_parent_email || '',
      // @ts-expect-error — joined object
      secondaryParentName: student.families?.secondary_parent_name || '',
      // @ts-expect-error — joined object
      secondaryParentPhone: student.families?.secondary_parent_phone || '',
      // @ts-expect-error — joined object
      secondaryParentEmail: student.families?.secondary_parent_email || '',
      // @ts-expect-error — joined object
      notes: student.families?.notes || '',
    },
    virtualAccount: {
      providerConfigured: !!schoolRow?.payment_provider,
      hasAccount: !!student.provider_dva_reference,
      accountNumber: student.provider_dva_account_number || null,
      bankName: student.provider_dva_bank_name || null,
    },
    siblings: siblingsWithStatus,
    currentTermName: currentCycle?.name || '',
    currentInvoice: currentInvoice ? {
      id: currentInvoice.id,
      lineItems: currentInvoice.line_items || [],
      subtotal: Number(currentInvoice.subtotal || 0),
      totalAmount: Number(currentInvoice.total_amount),
      paidAmount: Number(currentInvoice.paid_amount),
      status: currentInvoice.status,
      generatedAt: currentInvoice.generated_at,
      fullyPaidAt: currentInvoice.fully_paid_at,
    } : null,
    payments,
  }
}
export async function getStudentPaymentHistory(studentId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return null

  // Verify student belongs to this school; credit_balance feeds the
  // "unapplied credit" note. The virtual account (DVA) now lives in the
  // student header, not this tab, so it's no longer fetched here.
  const { data: student } = await supabase
    .from('students')
    .select('id, credit_balance')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!student) return null

  // Get all invoices for this student, with billing cycle info
  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      id,
      total_amount,
      paid_amount,
      status,
      generated_at,
      fully_paid_at,
      line_items,
      billing_cycle_id,
      billing_cycles!inner(id, name)
    `)
    .eq('student_id', studentId)
    .order('generated_at', { ascending: false })

  // Get all payments for this student
  const { data: payments } = await supabase
    .from('payments')
    .select(`
      id,
      amount,
      method,
      paid_at,
      provider_reference,
      invoice_id
    `)
    .eq('student_id', studentId)
    .eq('match_status', 'matched')
    .order('paid_at', { ascending: false })

  // Compute summary numbers
  const totalInvoiced = invoices?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0
  // Real cash received, not invoice-derived — a payment that arrived before
  // any invoice existed (or after every invoice was already settled) has no
  // invoice.paid_amount to be summed into, but the family really did send
  // it. Summing payments directly means this never reads as "₦0 paid" while
  // money is actually sitting on the student's credit_balance.
  const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
  // Outstanding stays invoice-scoped on purpose — it's "what's still owed
  // against what's been billed," independent of any unapplied credit.
  const outstanding = invoices?.reduce((sum, inv) => sum + Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount)), 0) || 0
  const termsInvoiced = invoices?.length || 0
  const unappliedCredit = Number(student.credit_balance || 0)

  // Format invoices
  const formattedInvoices = invoices?.map(inv => ({
    id: inv.id,
    // @ts-expect-error — joined object
    termName: inv.billing_cycles?.name || '',
    totalAmount: Number(inv.total_amount),
    paidAmount: Number(inv.paid_amount),
    status: inv.status,
    generatedAt: inv.generated_at,
    fullyPaidAt: inv.fully_paid_at,
    lineItems: inv.line_items || [],
  })) || []

  // Format payments with which invoice (term) they applied to
  const invoiceLookup = new Map(
    invoices?.map(inv => [
      inv.id, 
      // @ts-expect-error — joined object
      inv.billing_cycles?.name || ''
    ]) || []
  )

  const formattedPayments = payments?.map(p => ({
    id: p.id,
    amount: Number(p.amount),
    method: p.method,
    paidAt: p.paid_at,
    reference: p.provider_reference || '',
    appliedTo: p.invoice_id ? invoiceLookup.get(p.invoice_id) || 'Unknown term' : 'Credit balance (not yet invoiced)',
  })) || []

  return {
    summary: {
      totalInvoiced,
      totalPaid,
      outstanding,
      termsInvoiced,
      unappliedCredit,
    },
    invoices: formattedInvoices,
    payments: formattedPayments,
  }
}
// ============ STUDENT FEES (for Fees tab) ============

export interface StudentFeeItem {
  id: string
  name: string
  amount: number
  isSchoolWide: boolean
  isRequired: boolean
  isOptional: boolean
  isExempted: boolean
  exemptionNotes?: string
  isOptedIn: boolean
  optInNotes?: string
}

export interface StudentFeesData {
  student: {
    id: string
    firstName: string
    lastName: string
    admissionNumber: string
    classId: string | null
    className: string
    status: string
  }
  cycle: {
    id: string
    name: string
    status: string
  } | null
  requiredFees: StudentFeeItem[]
  optionalFees: StudentFeeItem[]
  requiredTotal: number
  exemptionTotal: number
  optInTotal: number
  expectedCreditApplied: number
  expectedBill: number
  existingInvoice: {
    id: string
    totalAmount: number
    paidAmount: number
    outstandingAmount: number
    creditApplied: number
    status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'
    sentAt: string | null
    needsResend: boolean
    previousBalance: number
    generatedAt: string
  } | null
}

export async function getStudentFees(studentId: string): Promise<StudentFeesData | null> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return null

  // Get student with class
  const { data: studentData } = await supabase
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      admission_number,
      class_id,
      status,
      credit_balance,
      classes(id, name)
    `)
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!studentData) return null

  const student = {
    id: studentData.id,
    firstName: studentData.first_name,
    lastName: studentData.last_name,
    admissionNumber: studentData.admission_number,
    classId: studentData.class_id,
    // @ts-expect-error — joined
    className: studentData.classes?.name || '',
    status: studentData.status,
  }

  // Get active billing cycle
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, name, status, start_date')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!cycle) {
    return {
      student,
      cycle: null,
      requiredFees: [],
      optionalFees: [],
      requiredTotal: 0,
      exemptionTotal: 0,
      optInTotal: 0,
      expectedBill: 0,
      expectedCreditApplied: 0,
      existingInvoice: null,
    }
  }

  // Get fee items that apply to this student
  let feeItemsQuery = supabase
    .from('fee_items')
    .select('id, class_id, name, amount, is_mandatory, is_optional_extra')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycle.id)

  if (student.classId) {
    feeItemsQuery = feeItemsQuery.or(`class_id.eq.${student.classId},class_id.is.null`)
  } else {
    feeItemsQuery = feeItemsQuery.is('class_id', null)
  }

  const { data: feeItems } = await feeItemsQuery

  // Get adjustments for this student
  const { data: adjustments } = await supabase
    .from('student_fee_adjustments')
    .select('fee_item_id, adjustment_type, notes')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)

  const optInsByFeeItem = new Map<string, { notes?: string }>()
  const exemptionsByFeeItem = new Map<string, { notes?: string }>()
  adjustments?.forEach(adj => {
    if (adj.adjustment_type === 'opt_in') {
      optInsByFeeItem.set(adj.fee_item_id, { notes: adj.notes || undefined })
    } else if (adj.adjustment_type === 'exempt') {
      exemptionsByFeeItem.set(adj.fee_item_id, { notes: adj.notes || undefined })
    }
  })

  const requiredFees: StudentFeeItem[] = []
  const optionalFees: StudentFeeItem[] = []

  feeItems?.forEach(f => {
    const exemption = exemptionsByFeeItem.get(f.id)
    const optIn = optInsByFeeItem.get(f.id)
    const isSchoolWide = f.class_id === null

    const item: StudentFeeItem = {
      id: f.id,
      name: f.name,
      amount: Number(f.amount),
      isSchoolWide,
      isRequired: f.is_mandatory,
      isOptional: f.is_optional_extra,
      isExempted: !!exemption,
      exemptionNotes: exemption?.notes,
      isOptedIn: !!optIn,
      optInNotes: optIn?.notes,
    }

    if (f.is_mandatory) {
      requiredFees.push(item)
    } else {
      optionalFees.push(item)
    }
  })

  function sortFn(a: StudentFeeItem, b: StudentFeeItem) {
    if (a.isSchoolWide !== b.isSchoolWide) return a.isSchoolWide ? -1 : 1
    return a.name.localeCompare(b.name)
  }
  requiredFees.sort(sortFn)
  optionalFees.sort(sortFn)

  const requiredTotal = requiredFees.reduce((sum, f) => sum + f.amount, 0)
  const exemptionTotal = requiredFees
    .filter(f => f.isExempted)
    .reduce((sum, f) => sum + f.amount, 0)
  const optInTotal = optionalFees
    .filter(f => f.isOptedIn)
    .reduce((sum, f) => sum + f.amount, 0)

    
  // After you have cycle.id, before computing expectedBill

  // Look up carry-forward from most recent closed term
  let carryForwardAmount = 0
  const { data: priorClosedCycle } = await supabase
    .from('billing_cycles')
    .select('id, start_date')
    .eq('school_id', schoolId)
    .eq('status', 'closed')
    .lt('start_date', cycle.start_date)  // needs cycle.start_date available
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (priorClosedCycle) {
    const { data: priorInvoice } = await supabase
      .from('invoices')
      .select('total_amount, paid_amount')
      .eq('student_id', studentId)
      .eq('billing_cycle_id', priorClosedCycle.id)
      .maybeSingle()

    if (priorInvoice) {
      const outstanding = Number(priorInvoice.total_amount) - Number(priorInvoice.paid_amount || 0)
      if (outstanding > 0) carryForwardAmount = outstanding
    }
  }

  // Check if an invoice already exists for this student + cycle
  const { data: existingInvoice } = await supabase
    .from('invoices')
    .select('id, total_amount, paid_amount, credit_applied, status, sent_at, needs_resend, previous_balance, line_items, generated_at')
    .eq('student_id', studentId)
    .eq('billing_cycle_id', cycle.id)
    .maybeSingle()

  // expectedBill must come from the same canonical computation used to
  // actually generate/regenerate invoices (computeInvoiceForStudent), not
  // a parallel hand-rolled formula — a second implementation is exactly
  // how this drifted out of sync with credit_applied in the first place.
  // Same restore-then-compare trick as the cycle-detail staleness check:
  // simulate this invoice's own credit being restored before recomputing,
  // so an already-correct invoice doesn't get flagged as stale forever.
  const effectiveCredit = Number(studentData.credit_balance || 0) + Number(existingInvoice?.credit_applied || 0)
  const computedBill = await computeInvoiceForStudent(supabase, schoolId, studentId, cycle.id, effectiveCredit, Number(existingInvoice?.paid_amount || 0))
  const expectedBill = !('error' in computedBill)
    ? computedBill.total
    : requiredTotal - exemptionTotal + optInTotal + carryForwardAmount
  // Needed alongside expectedBill for staleness comparison — a fee change
  // (e.g. a new opt-in) can leave the final total unchanged when credit
  // fully covers the bill either way, while credit_applied itself differs.
  // Comparing total alone would miss that the invoice is genuinely stale.
  const expectedCreditApplied = !('error' in computedBill) ? computedBill.creditApplied : 0

  const existingInvoiceInfo = existingInvoice ? {
    id: existingInvoice.id,
    totalAmount: Number(existingInvoice.total_amount),
    paidAmount: Number(existingInvoice.paid_amount || 0),
    outstandingAmount: Number(existingInvoice.total_amount) - Number(existingInvoice.paid_amount || 0),
    creditApplied: Number(existingInvoice.credit_applied || 0),
    status: existingInvoice.status as 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled',
    sentAt: existingInvoice.sent_at,
    needsResend: existingInvoice.needs_resend,
    previousBalance: Number(existingInvoice.previous_balance || 0),
    generatedAt: existingInvoice.generated_at,
  } : null

return {
    student,
    cycle: { id: cycle.id, name: cycle.name, status: cycle.status },
    requiredFees,
    optionalFees,
    requiredTotal,
    exemptionTotal,
    optInTotal,
    expectedBill,
    expectedCreditApplied,
    existingInvoice: existingInvoiceInfo,
  }
}