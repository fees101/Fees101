import { createClient } from '@/lib/supabase/server'

export async function getFeesOverview(cycleId?: string) {
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
  if (!schoolId) {
    return {
      totalExpectedThisTerm: 0,
      totalCollected: 0,
      activeClasses: 0,
      studentsWithInvoices: 0,
      totalActiveStudents: 0,
      currentTermName: '',
      currentTermStatus: '',
      hasCurrentTerm: false,
    }
  }

  // ONLY load active term as default. Draft terms are not "current."
  let cycle
  if (cycleId) {
    const { data } = await supabase
      .from('billing_cycles')
      .select('id, name, status')
      .eq('id', cycleId)
      .eq('school_id', schoolId)
      .single()
    cycle = data
  } else {
    const { data } = await supabase
      .from('billing_cycles')
      .select('id, name, status')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
    cycle = data
  }

  const { count: activeClasses } = await supabase
    .from('classes')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('is_active', true)

  const { count: totalActiveStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')

  let totalExpectedThisTerm = 0
  let totalCollected = 0
  let studentsWithInvoices = 0

  if (cycle) {
    const { data: invoices } = await supabase
      .from('invoices')
      .select('total_amount, paid_amount, student_id')
      .eq('billing_cycle_id', cycle.id)

    totalExpectedThisTerm = invoices?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0
    totalCollected = invoices?.reduce((sum, inv) => sum + Number(inv.paid_amount || 0), 0) || 0
    studentsWithInvoices = invoices?.length || 0
  }

  return {
    totalExpectedThisTerm,
    totalCollected,
    activeClasses: activeClasses || 0,
    studentsWithInvoices,
    totalActiveStudents: totalActiveStudents || 0,
    currentTermName: cycle?.name || '',
    currentTermStatus: cycle?.status || '',
    hasCurrentTerm: !!cycle,
  }
}

export async function getClasses() {
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
  if (!schoolId) return { classes: [], sections: [] }

  const { data: sections } = await supabase
    .from('sections')
    .select('id, name')
    .eq('school_id', schoolId)
    .order('display_order')

  const { data: classes } = await supabase
    .from('classes')
    .select(`
      id,
      name,
      display_order,
      is_active,
      section_id,
      sections(name)
    `)
    .eq('school_id', schoolId)
    .order('display_order')

  if (!classes) return { classes: [], sections: sections || [] }

  const classIds = classes.map(c => c.id)
  const { data: studentCounts } = await supabase
    .from('students')
    .select('class_id')
    .in('class_id', classIds)
    .eq('status', 'active')

  const { data: feeItemCounts } = await supabase
    .from('fee_items')
    .select('class_id')
    .in('class_id', classIds)

  const studentCountMap: Record<string, number> = {}
  studentCounts?.forEach(s => {
    if (s.class_id) {
      studentCountMap[s.class_id] = (studentCountMap[s.class_id] || 0) + 1
    }
  })

  const feeItemCountMap: Record<string, number> = {}
  feeItemCounts?.forEach(f => {
    if (f.class_id) {
      feeItemCountMap[f.class_id] = (feeItemCountMap[f.class_id] || 0) + 1
    }
  })

  const classesWithCounts = classes.map(cls => ({
    id: cls.id,
    name: cls.name,
    displayOrder: cls.display_order,
    isActive: cls.is_active,
    sectionId: cls.section_id,
    // @ts-expect-error — joined object
    sectionName: cls.sections?.name || '',
    studentCount: studentCountMap[cls.id] || 0,
    feeItemCount: feeItemCountMap[cls.id] || 0,
  }))

  return {
    classes: classesWithCounts,
    sections: sections || [],
  }
}

export async function getFeeStructure(billingCycleId?: string) {
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

  let cycle
  if (billingCycleId) {
    const { data } = await supabase
      .from('billing_cycles')
      .select('id, name, status')
      .eq('id', billingCycleId)
      .eq('school_id', schoolId)
      .single()
    cycle = data
  } else {
    const { data } = await supabase
      .from('billing_cycles')
      .select('id, name, status')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .single()
    cycle = data
  }

  if (!cycle) {
    return {
      cycle: null,
      classes: [],
      allFees: [],
      studentCountByClass: {},
      totalActiveStudents: 0,
    }
  }

  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, display_order')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order')

  const { data: feeItems } = await supabase
    .from('fee_items')
    .select('id, class_id, name, amount, is_mandatory, is_optional_extra')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycle.id)

  // Get active students per class (for revenue calculation)
  const { data: students } = await supabase
    .from('students')
    .select('class_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')

  const studentCountByClass: Record<string, number> = {}
  let totalActiveStudents = 0
  students?.forEach(s => {
    totalActiveStudents++
    if (s.class_id) {
      studentCountByClass[s.class_id] = (studentCountByClass[s.class_id] || 0) + 1
    }
  })

  const allFees = feeItems || []

  // Get opt-in counts for optional fees
  const optionalFeeIds = allFees.filter(f => f.is_optional_extra).map(f => f.id)
  const optInCountMap: Record<string, number> = {}
  if (optionalFeeIds.length > 0) {
    const { data: optIns } = await supabase
      .from('student_fee_adjustments')
      .select('fee_item_id')
      .in('fee_item_id', optionalFeeIds)
      .eq('adjustment_type', 'opt_in')
    optIns?.forEach(o => {
      optInCountMap[o.fee_item_id] = (optInCountMap[o.fee_item_id] || 0) + 1
    })
  }

  return {
    cycle,
    classes: (classes || []).map(c => ({
      id: c.id,
      name: c.name,
      displayOrder: c.display_order,
    })),
    allFees: allFees.map(f => ({
      id: f.id,
      classId: f.class_id,
      name: f.name,
      amount: Number(f.amount),
      isRequired: f.is_mandatory,
      isOptional: f.is_optional_extra,
      isSchoolWide: f.class_id === null,
      optInCount: optInCountMap[f.id] || 0,
    })),
    studentCountByClass,
    totalActiveStudents,
  }
}
// ============ CYCLES + SESSIONS (for /fees/cycles page) ============

export interface SessionRow {
  id: string
  name: string
  startDate: string
  endDate: string
  status: 'active' | 'closed'
}

export interface CycleRow {
  id: string
  name: string
  startDate: string
  endDate: string
  dueDate: string | null
  status: 'draft' | 'active' | 'closed'
  sessionId: string | null
  sessionName: string | null
  invoiceCount: number
  studentsInvoiced: number
  totalActiveStudents: number
  totalExpected: number
  totalCollected: number
  feeItemCount: number
}

async function getSchoolContext() {
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

  return { supabase, schoolId }
}

export async function getSessions(): Promise<SessionRow[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

  const { data } = await supabase
    .from('sessions')
    .select('id, name, start_date, end_date, status')
    .eq('school_id', schoolId)
    .order('start_date', { ascending: false })

  return (data || []).map(s => ({
    id: s.id,
    name: s.name,
    startDate: s.start_date,
    endDate: s.end_date,
    status: s.status as 'active' | 'closed',
  }))
}

export async function getAllCycles(): Promise<CycleRow[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

  // Get all cycles with their session info
  const { data: cycles } = await supabase
    .from('billing_cycles')
    .select(`
      id,
      name,
      start_date,
      end_date,
      due_date,
      status,
      session_id,
      sessions(name)
    `)
    .eq('school_id', schoolId)
    .order('start_date', { ascending: false })

  if (!cycles || cycles.length === 0) return []

  const cycleIds = cycles.map(c => c.id)

  // Get total active students (for "X of Y invoiced")
  const { count: totalActiveStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')

  // Get invoice stats per cycle
  const { data: invoices } = await supabase
    .from('invoices')
    .select('billing_cycle_id, total_amount, paid_amount')
    .in('billing_cycle_id', cycleIds)

  const invoiceStats: Record<string, { count: number, expected: number, collected: number }> = {}
  invoices?.forEach(inv => {
    const stat = invoiceStats[inv.billing_cycle_id] ||= { count: 0, expected: 0, collected: 0 }
    stat.count++
    stat.expected += Number(inv.total_amount || 0)
    stat.collected += Number(inv.paid_amount || 0)
  })

  // Get fee item counts per cycle
  const { data: feeItems } = await supabase
    .from('fee_items')
    .select('billing_cycle_id')
    .in('billing_cycle_id', cycleIds)

  const feeItemStats: Record<string, number> = {}
  feeItems?.forEach(f => {
    feeItemStats[f.billing_cycle_id] = (feeItemStats[f.billing_cycle_id] || 0) + 1
  })

  return cycles.map(c => {
    const stats = invoiceStats[c.id] || { count: 0, expected: 0, collected: 0 }
    return {
      id: c.id,
      name: c.name,
      startDate: c.start_date,
      endDate: c.end_date,
      dueDate: c.due_date,
      status: c.status as 'draft' | 'active' | 'closed',
      sessionId: c.session_id,
      // @ts-expect-error — joined
      sessionName: c.sessions?.name || null,
      invoiceCount: stats.count,
      studentsInvoiced: stats.count,
      totalActiveStudents: totalActiveStudents || 0,
      totalExpected: stats.expected,
      totalCollected: stats.collected,
      feeItemCount: feeItemStats[c.id] || 0,
    }
  })
}

export async function getCycleById(id: string): Promise<CycleRow | null> {
  const all = await getAllCycles()
  return all.find(c => c.id === id) || null
}
// ============ CYCLE DETAIL (for /fees/cycles/[id] page) ============

export interface InvoiceRow {
  id: string
  invoiceNumber: string | null
  studentId: string
  studentFirstName: string
  studentLastName: string
  studentAdmissionNumber: string
  className: string
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'
  sentAt: string | null
  needsResend: boolean
  previousBalance: number
  generatedAt: string
  lineItems: Array<{ name: string, amount: number, kind?: string }>
}

export interface CycleDetailData {
  cycle: CycleRow | null
  invoices: InvoiceRow[]
  studentsWithoutInvoices: Array<{
    id: string
    firstName: string
    lastName: string
    admissionNumber: string
    classId: string | null
    className: string
  }>
  totalActiveStudents: number
  totalsByStatus: {
    paid: number
    partial: number
    pending: number
    overdue: number
    needsResend: number
  }
}

export async function getCycleDetailById(cycleId: string): Promise<CycleDetailData | null> {
  const ctx = await getSchoolContext()
  if (!ctx) return null
  const { supabase, schoolId } = ctx

  // Get cycle
  const { data: cycleData } = await supabase
    .from('billing_cycles')
    .select(`
      id,
      name,
      start_date,
      end_date,
      due_date,
      status,
      session_id,
      sessions(name)
    `)
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()

  if (!cycleData) return null

  // Get total active students for the school
  const { count: totalActiveStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')

  // Get all invoices for this cycle
  const { data: invoiceData } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      student_id,
      total_amount,
      paid_amount,
      outstanding_amount,
      status,
      sent_at,
      needs_resend,
      previous_balance,
      generated_at,
      line_items,
      students(first_name, last_name, admission_number, class_id, classes(name))
    `)
    .eq('billing_cycle_id', cycleId)
    .order('generated_at', { ascending: false })

  const invoices: InvoiceRow[] = (invoiceData || []).map(inv => ({
    id: inv.id,
    invoiceNumber: inv.invoice_number || null,
    studentId: inv.student_id,
    // @ts-expect-error — joined
    studentFirstName: inv.students?.first_name || '',
    // @ts-expect-error — joined
    studentLastName: inv.students?.last_name || '',
    // @ts-expect-error — joined
    studentAdmissionNumber: inv.students?.admission_number || '',
    // @ts-expect-error — joined
    className: inv.students?.classes?.name || '',
    totalAmount: Number(inv.total_amount),
    paidAmount: Number(inv.paid_amount || 0),
    outstandingAmount: Number(inv.outstanding_amount || (Number(inv.total_amount) - Number(inv.paid_amount || 0))),
    status: inv.status as InvoiceRow['status'],
    sentAt: inv.sent_at,
    needsResend: inv.needs_resend,
    previousBalance: Number(inv.previous_balance || 0),
    generatedAt: inv.generated_at,
    lineItems: (inv.line_items as InvoiceRow['lineItems']) || [],
  }))

  // Get students who DON'T have an invoice for this cycle
  const invoicedStudentIds = new Set(invoices.map(i => i.studentId))

  const { data: allActiveStudents } = await supabase
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      admission_number,
      class_id,
      classes(name)
    `)
    .eq('school_id', schoolId)
    .eq('status', 'active')

  const studentsWithoutInvoices = (allActiveStudents || [])
    .filter(s => !invoicedStudentIds.has(s.id))
    .map(s => ({
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      admissionNumber: s.admission_number,
      classId: s.class_id,
      // @ts-expect-error — joined
      className: s.classes?.name || '',
    }))

  // Stats by status
  const totalsByStatus = {
    paid: invoices.filter(i => i.status === 'paid').length,
    partial: invoices.filter(i => i.status === 'partial').length,
    pending: invoices.filter(i => i.status === 'pending').length,
    overdue: invoices.filter(i => i.status === 'overdue').length,
    needsResend: invoices.filter(i => i.needsResend).length,
  }

  // Reuse the getAllCycles shape for cycle stats — compute here from invoices
  const totalExpected = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const totalCollected = invoices.reduce((s, i) => s + i.paidAmount, 0)

  const cycle: CycleRow = {
    id: cycleData.id,
    name: cycleData.name,
    startDate: cycleData.start_date,
    endDate: cycleData.end_date,
    dueDate: cycleData.due_date,
    status: cycleData.status as 'draft' | 'active' | 'closed',
    sessionId: cycleData.session_id,
    // @ts-expect-error — joined
    sessionName: cycleData.sessions?.name || null,
    invoiceCount: invoices.length,
    studentsInvoiced: invoices.length,
    totalActiveStudents: totalActiveStudents || 0,
    totalExpected,
    totalCollected,
    feeItemCount: 0, // not needed here
  }

  return {
    cycle,
    invoices,
    studentsWithoutInvoices,
    totalActiveStudents: totalActiveStudents || 0,
    totalsByStatus,
  }
}

// ============ INVOICE DETAIL ============

export interface InvoiceDetail {
  id: string
  invoiceNumber: string | null
  studentId: string
  studentFirstName: string
  studentLastName: string
  studentAdmissionNumber: string
  className: string
  cycleId: string
  cycleName: string
  cycleDueDate: string | null
  schoolName: string
  schoolAddress: string | null
  schoolPhone: string | null
  schoolEmail: string | null
  proprietressName: string | null
  primaryParentName: string
  primaryParentPhone: string
  lineItems: Array<{ name: string, amount: number, kind?: string }>
  subtotal: number
  discountAmount: number
  previousBalance: number
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'
  sentAt: string | null
  needsResend: boolean
  generatedAt: string
  fullyPaidAt: string | null
  payments?: Array<{
    id: string
    amount: number
    method: string
    paidAt: string
    reference: string
    receivedByName: string | null
  }>
}

export async function getInvoiceById(invoiceId: string): Promise<InvoiceDetail | null> {
  const ctx = await getSchoolContext()
  if (!ctx) return null
  const { supabase, schoolId } = ctx

  const { data: invoice } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      total_amount,
      subtotal,
      discount_amount,
      previous_balance,
      paid_amount,
      status,
      sent_at,
      needs_resend,
      generated_at,
      fully_paid_at,
      line_items,
      students!inner(
        id,
        first_name,
        last_name,
        admission_number,
        classes(name),
        families(primary_parent_name, primary_parent_phone)
      ),
      billing_cycles!inner(id, name, due_date)
    `)
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!invoice) return null

  // Get school info
  const { data: school } = await supabase
    .from('schools')
    .select('name, address, phone, email, proprietress_name')
    .eq('id', schoolId)
    .single()

  // Get recorded payments for this invoice
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount, method, paid_at, paystack_reference, users(name)')
    .eq('invoice_id', invoiceId)
    .eq('match_status', 'matched')
    .order('paid_at', { ascending: false })

  const total = Number(invoice.total_amount)
  const paid = Number(invoice.paid_amount || 0)

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number || null,
    // @ts-expect-error — joined
    studentId: invoice.students.id,
    // @ts-expect-error
    studentFirstName: invoice.students.first_name,
    // @ts-expect-error
    studentLastName: invoice.students.last_name,
    // @ts-expect-error
    studentAdmissionNumber: invoice.students.admission_number,
    // @ts-expect-error
    className: invoice.students.classes?.name || '',
    // @ts-expect-error
    cycleId: invoice.billing_cycles.id,
    // @ts-expect-error
    cycleName: invoice.billing_cycles.name,
    // @ts-expect-error
    cycleDueDate: invoice.billing_cycles.due_date,
    schoolName: school?.name || '',
    schoolAddress: school?.address || null,
    schoolPhone: school?.phone || null,
    schoolEmail: school?.email || null,
    proprietressName: school?.proprietress_name || null,
    // @ts-expect-error
    primaryParentName: invoice.students.families?.primary_parent_name || '',
    // @ts-expect-error
    primaryParentPhone: invoice.students.families?.primary_parent_phone || '',
    lineItems: (invoice.line_items as InvoiceDetail['lineItems']) || [],
    subtotal: Number(invoice.subtotal || 0),
    discountAmount: Number(invoice.discount_amount || 0),
    previousBalance: Number(invoice.previous_balance || 0),
    totalAmount: total,
    paidAmount: paid,
    outstandingAmount: total - paid,
    status: invoice.status,
    sentAt: invoice.sent_at,
    needsResend: invoice.needs_resend,
    generatedAt: invoice.generated_at,
    fullyPaidAt: invoice.fully_paid_at,
    payments: (payments || []).map(p => ({
      id: p.id,
      amount: Number(p.amount),
      method: p.method,
      paidAt: p.paid_at,
      reference: p.paystack_reference || '',
      // @ts-expect-error — joined
      receivedByName: p.users?.name || null,
    })),
  }
}

export async function getInvoicesByCycleId(cycleId: string): Promise<InvoiceDetail[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      total_amount,
      subtotal,
      discount_amount,
      previous_balance,
      paid_amount,
      status,
      sent_at,
      needs_resend,
      generated_at,
      fully_paid_at,
      line_items,
      students!inner(
        id,
        first_name,
        last_name,
        admission_number,
        classes(name, display_order),
        families(primary_parent_name, primary_parent_phone)
      ),
      billing_cycles!inner(id, name, due_date)
    `)
    .eq('billing_cycle_id', cycleId)
    .eq('school_id', schoolId)

  if (!invoices) return []

  const { data: school } = await supabase
    .from('schools')
    .select('name, address, phone, email, proprietress_name')
    .eq('id', schoolId)
    .single()

  // Print order: class display_order (Play Pen → Year 11), then last name within each class.
  const sorted = [...invoices].sort((a, b) => {
    // @ts-expect-error — joined object
    const orderA = a.students?.classes?.display_order ?? 9999
    // @ts-expect-error — joined object
    const orderB = b.students?.classes?.display_order ?? 9999
    if (orderA !== orderB) return orderA - orderB
    // @ts-expect-error — joined object
    return (a.students?.last_name || '').localeCompare(b.students?.last_name || '')
  })

  return sorted.map(invoice => {
    const total = Number(invoice.total_amount)
    const paid = Number(invoice.paid_amount || 0)
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number || null,
      // @ts-expect-error
      studentId: invoice.students.id,
      // @ts-expect-error
      studentFirstName: invoice.students.first_name,
      // @ts-expect-error
      studentLastName: invoice.students.last_name,
      // @ts-expect-error
      studentAdmissionNumber: invoice.students.admission_number,
      // @ts-expect-error
      className: invoice.students.classes?.name || '',
      // @ts-expect-error
      cycleId: invoice.billing_cycles.id,
      // @ts-expect-error
      cycleName: invoice.billing_cycles.name,
      // @ts-expect-error
      cycleDueDate: invoice.billing_cycles.due_date,
      schoolName: school?.name || '',
      schoolAddress: school?.address || null,
      schoolPhone: school?.phone || null,
      schoolEmail: school?.email || null,
      proprietressName: school?.proprietress_name || null,
      // @ts-expect-error
      primaryParentName: invoice.students.families?.primary_parent_name || '',
      // @ts-expect-error
      primaryParentPhone: invoice.students.families?.primary_parent_phone || '',
      lineItems: (invoice.line_items as InvoiceDetail['lineItems']) || [],
      subtotal: Number(invoice.subtotal || 0),
      discountAmount: Number(invoice.discount_amount || 0),
      previousBalance: Number(invoice.previous_balance || 0),
      totalAmount: total,
      paidAmount: paid,
      outstandingAmount: total - paid,
      status: invoice.status,
      sentAt: invoice.sent_at,
      needsResend: invoice.needs_resend,
      generatedAt: invoice.generated_at,
      fullyPaidAt: invoice.fully_paid_at,
    }
  })
}