import { createClient } from '@/lib/supabase/server'
import { computeInvoiceForStudent } from '@/lib/computeInvoice'

function composeAddress(street?: string | null, city?: string | null, state?: string | null): string | null {
  const parts = [street, city, state].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

function composeProprietressName(title?: string | null, firstName?: string | null, lastName?: string | null): string | null {
  const parts = [title, firstName, lastName].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

// "Collected" is attributed to whichever term was active when money actually
// arrived (paid_at), never to the term of whichever invoice it's later
// applied to via credit_applied. A credit draw-down never creates a new
// payments row, so summing real payments by paid_at naturally excludes
// credit applications with no special-casing needed.
export async function getCollectedForDateRange(supabase: any, schoolId: string, startDate: string, endDate: string): Promise<number> {
  const endExclusive = new Date(endDate)
  endExclusive.setDate(endExclusive.getDate() + 1)

  const { data } = await supabase
    .from('payments')
    .select('amount')
    .eq('school_id', schoolId)
    .eq('match_status', 'matched')
    .gte('paid_at', startDate)
    .lt('paid_at', endExclusive.toISOString())

  return (data || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0)
}

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
      totalOutstanding: 0,
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
      .select('id, name, status, start_date, end_date')
      .eq('id', cycleId)
      .eq('school_id', schoolId)
      .single()
    cycle = data
  } else {
    const { data } = await supabase
      .from('billing_cycles')
      .select('id, name, status, start_date, end_date')
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
  let totalOutstanding = 0
  let studentsWithInvoices = 0

  if (cycle) {
    const { data: invoices } = await supabase
      .from('invoices')
      .select('total_amount, paid_amount, credit_applied, student_id')
      .eq('billing_cycle_id', cycle.id)

    // Expected = gross fees for the term = net total plus whatever credit
    // covered part of it (total_amount is already net of credit_applied).
    totalExpectedThisTerm = invoices?.reduce((sum, inv) => sum + Number(inv.total_amount) + Number(inv.credit_applied || 0), 0) || 0
    // Outstanding = what's still owed on these invoices (net total minus
    // direct payments). Always invoice-derived — NEVER expected minus
    // collected, which goes negative once date-based collected exceeds
    // what's been billed so far.
    totalOutstanding = invoices?.reduce((sum, inv) => sum + Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount || 0)), 0) || 0
    studentsWithInvoices = invoices?.length || 0
    // Collected = real money received while this term was active, by
    // payment date — not what's allocated to this term's invoices. See
    // getCollectedForDateRange.
    totalCollected = await getCollectedForDateRange(supabase, schoolId, cycle.start_date, cycle.end_date)
  }

  return {
    totalExpectedThisTerm,
    totalCollected,
    totalOutstanding,
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
      next_class_id,
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
    nextClassId: cls.next_class_id,
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
    .select('id, class_id, name, amount, is_mandatory, is_optional_extra, is_discountable')
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
      isDiscountable: f.is_discountable !== false,
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
  status: 'draft' | 'active' | 'closed'
}

export interface CycleRow {
  id: string
  name: string
  startDate: string
  endDate: string
  dueDate: string | null
  closedAt: string | null
  status: 'draft' | 'active' | 'closed'
  sessionId: string | null
  sessionName: string | null
  invoiceCount: number
  studentsInvoiced: number
  totalActiveStudents: number
  totalExpected: number
  totalCollected: number
  totalOutstanding: number
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
    status: s.status as 'draft' | 'active' | 'closed',
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
      closed_at,
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

  // Get invoice stats per cycle (expected/count/outstanding — collected is payment-date-based, below)
  const { data: invoices } = await supabase
    .from('invoices')
    .select('billing_cycle_id, total_amount, paid_amount, credit_applied')
    .in('billing_cycle_id', cycleIds)

  const invoiceStats: Record<string, { count: number, expected: number, outstanding: number }> = {}
  invoices?.forEach(inv => {
    const stat = invoiceStats[inv.billing_cycle_id] ||= { count: 0, expected: 0, outstanding: 0 }
    stat.count++
    // total_amount is already net of credit_applied (computeInvoiceForStudent
    // sets total = amountDue - creditApplied) — add it back so "expected"
    // reflects the gross fee actually due, not the post-credit remainder.
    stat.expected += Number(inv.total_amount || 0) + Number(inv.credit_applied || 0)
    stat.outstanding += Math.max(0, Number(inv.total_amount || 0) - Number(inv.paid_amount || 0))
  })

  // Collected is attributed by payment date, not invoice allocation — fetch
  // every matched payment once and bucket into whichever cycle's date range
  // it falls in, rather than N+1 queries per cycle.
  const { data: allPayments } = await supabase
    .from('payments')
    .select('amount, paid_at')
    .eq('school_id', schoolId)
    .eq('match_status', 'matched')

  const collectedByCycle: Record<string, number> = {}
  cycles.forEach(c => {
    const start = new Date(c.start_date)
    const endExclusive = new Date(c.end_date)
    endExclusive.setDate(endExclusive.getDate() + 1)
    collectedByCycle[c.id] = (allPayments || [])
      .filter((p: any) => {
        const paidAt = new Date(p.paid_at)
        return paidAt >= start && paidAt < endExclusive
      })
      .reduce((sum: number, p: any) => sum + Number(p.amount), 0)
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
    const stats = invoiceStats[c.id] || { count: 0, expected: 0, outstanding: 0 }
    return {
      id: c.id,
      name: c.name,
      startDate: c.start_date,
      endDate: c.end_date,
      dueDate: c.due_date,
      closedAt: c.closed_at,
      status: c.status as 'draft' | 'active' | 'closed',
      sessionId: c.session_id,
      // @ts-expect-error — joined
      sessionName: c.sessions?.name || null,
      invoiceCount: stats.count,
      studentsInvoiced: stats.count,
      totalActiveStudents: totalActiveStudents || 0,
      totalExpected: stats.expected,
      totalCollected: collectedByCycle[c.id] || 0,
      totalOutstanding: stats.outstanding,
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
  needsRegeneration: boolean
  previousBalance: number
  creditApplied: number
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
    needsRegeneration: number
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
      closed_at,
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
      credit_applied,
      generated_at,
      line_items,
      students(first_name, last_name, admission_number, class_id, credit_balance, classes(name))
    `)
    .eq('billing_cycle_id', cycleId)
    .order('generated_at', { ascending: false })

  // Student's live credit_balance already has this invoice's own
  // credit_applied subtracted out — need it for the staleness override below.
  const studentLiveCreditBalance: Record<string, number> = {}
  ;(invoiceData || []).forEach(inv => {
    // @ts-expect-error — joined
    studentLiveCreditBalance[inv.student_id] = Number(inv.students?.credit_balance || 0)
  })

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
    needsRegeneration: false,
    previousBalance: Number(inv.previous_balance || 0),
    creditApplied: Number(inv.credit_applied || 0),
    generatedAt: inv.generated_at,
    lineItems: (inv.line_items as InvoiceRow['lineItems']) || [],
  }))

  // Closed terms are frozen (fee edits are blocked), so an invoice generated
  // there can never drift — skip the recompute pass entirely.
  if (cycleData.status !== 'closed') {
    for (const inv of invoices) {
      // Simulate "what if this invoice's own credit were restored, then
      // recomputed" — the same restore-then-compare logic regeneration
      // actually performs — without mutating anything. Comparing against
      // the live (already-reduced) balance directly would flag every
      // credit-touched invoice as stale forever, since the balance it
      // originally consumed is now gone from the live figure.
      const effectiveCredit = (studentLiveCreditBalance[inv.studentId] || 0) + inv.creditApplied
      // Pass inv.id so any manual one-off discount already applied to THIS
      // invoice is folded into the recompute — without it the check would
      // recompute a higher total (no discount) and flag the invoice stale
      // forever, while a regenerate (which does pass the id) produces the
      // same stored value, so the banner could never clear.
      const computed = await computeInvoiceForStudent(supabase, schoolId, inv.studentId, cycleId, effectiveCredit, inv.paidAmount, inv.id)
      // Compare creditApplied too, not just total — a fee change can leave
      // the total unchanged when credit fully covers the bill either way,
      // while what's actually owed and drawn from credit still differs.
      if (!('error' in computed) && (computed.total !== inv.totalAmount || computed.creditApplied !== inv.creditApplied)) {
        inv.needsRegeneration = true
      }
    }
  }

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
    needsRegeneration: invoices.filter(i => i.needsRegeneration).length,
  }

  // Reuse the getAllCycles shape for cycle stats. totalAmount is already net
  // of creditApplied, so expected (the gross fee due) has to add it back.
  const totalExpected = invoices.reduce((s, i) => s + i.totalAmount + i.creditApplied, 0)
  const totalOutstanding = invoices.reduce((s, i) => s + Math.max(0, i.totalAmount - i.paidAmount), 0)
  // Collected is attributed by payment date, not invoice allocation — see getCollectedForDateRange.
  const totalCollected = await getCollectedForDateRange(supabase, schoolId, cycleData.start_date, cycleData.end_date)

  const cycle: CycleRow = {
    id: cycleData.id,
    name: cycleData.name,
    startDate: cycleData.start_date,
    endDate: cycleData.end_date,
    dueDate: cycleData.due_date,
    closedAt: cycleData.closed_at,
    status: cycleData.status as 'draft' | 'active' | 'closed',
    sessionId: cycleData.session_id,
    // @ts-expect-error — joined
    sessionName: cycleData.sessions?.name || null,
    invoiceCount: invoices.length,
    studentsInvoiced: invoices.length,
    totalActiveStudents: totalActiveStudents || 0,
    totalExpected,
    totalCollected,
    totalOutstanding,
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
  schoolLogoUrl: string | null
  schoolAddress: string | null
  schoolPhone: string | null
  schoolEmail: string | null
  proprietressName: string | null
  primaryParentName: string
  primaryParentPhone: string
  dvaAccountNumber: string | null
  dvaBankName: string | null
  lineItems: Array<{ name: string, amount: number, kind?: string }>
  subtotal: number
  discountAmount: number
  discountReason: string
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
    // Set when this payment was one piece of a larger transfer that got
    // split across multiple invoices/credit — so a parent looking at just
    // this invoice isn't left wondering where the rest of their money went.
    transactionTotal?: number
    otherAllocations?: Array<{ termName: string | null, amount: number }>
  }>
}

export async function getInvoiceById(invoiceId: string): Promise<InvoiceDetail | null> {
  const ctx = await getSchoolContext()
  if (!ctx) return null
  return getInvoiceByIdForSchool(ctx.supabase, ctx.schoolId, invoiceId)
}

// Same as getInvoiceById but takes an already-resolved supabase client + schoolId
// instead of deriving them from the request's cookies — usable from cron jobs,
// webhooks, and other contexts with no logged-in user session.
export async function getInvoiceByIdForSchool(supabase: any, schoolId: string, invoiceId: string): Promise<InvoiceDetail | null> {
  const { data: invoice } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      total_amount,
      subtotal,
      discount_amount,
      discount_reason,
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
        provider_dva_account_number,
        provider_dva_bank_name,
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
    .select('name, logo_url, address_street, address_city, address_state, phone, email, proprietress_title, proprietress_first_name, proprietress_last_name')
    .eq('id', schoolId)
    .single()

  // Get recorded payments for this invoice
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount, method, paid_at, provider_reference, provider, provider_transaction_id, users(name)')
    .eq('invoice_id', invoiceId)
    .eq('match_status', 'matched')
    .order('paid_at', { ascending: false })

  // For any payment that was part of a larger transfer split across other
  // invoices (or credit), pull the sibling rows so we can show where the
  // rest of the money went — otherwise a parent looking at just this
  // invoice has no way to know their payment was bigger than what landed
  // here.
  const transactionIds = [...new Set((payments || []).map((p: any) => p.provider_transaction_id).filter(Boolean))]
  const siblingsByTransaction: Record<string, Array<{ amount: number, termName: string | null }>> = {}

  if (transactionIds.length > 0) {
    const { data: siblingRows } = await supabase
      .from('payments')
      .select('amount, provider_transaction_id, invoice_id, invoices(billing_cycles(name))')
      .eq('school_id', schoolId)
      .in('provider_transaction_id', transactionIds)
      .neq('invoice_id', invoiceId)

    ;(siblingRows || []).forEach((s: any) => {
      const txId = s.provider_transaction_id
      if (!siblingsByTransaction[txId]) siblingsByTransaction[txId] = []
      siblingsByTransaction[txId].push({
        amount: Number(s.amount),
        termName: s.invoices?.billing_cycles?.name || null, // null invoice_id (credit) or unlinked
      })
    })
    // A payment with no invoice at all (went straight to credit_balance)
    // also needs to be caught — the query above excludes rows matching
    // THIS invoice_id, but a null invoice_id row is naturally != invoiceId
    // already, so it's included above with termName: null (credit).
  }

  const total = Number(invoice.total_amount)
  const paid = Number(invoice.paid_amount || 0)

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number || null,
    studentId: invoice.students.id,
    studentFirstName: invoice.students.first_name,
    studentLastName: invoice.students.last_name,
    studentAdmissionNumber: invoice.students.admission_number,
    className: invoice.students.classes?.name || '',
    cycleId: invoice.billing_cycles.id,
    cycleName: invoice.billing_cycles.name,
    cycleDueDate: invoice.billing_cycles.due_date,
    schoolName: school?.name || '',
    schoolLogoUrl: school?.logo_url || null,
    schoolAddress: composeAddress(school?.address_street, school?.address_city, school?.address_state),
    schoolPhone: school?.phone || null,
    schoolEmail: school?.email || null,
    proprietressName: composeProprietressName(school?.proprietress_title, school?.proprietress_first_name, school?.proprietress_last_name),
    primaryParentName: invoice.students.families?.primary_parent_name || '',
    primaryParentPhone: invoice.students.families?.primary_parent_phone || '',
    dvaAccountNumber: invoice.students.provider_dva_account_number || null,
    dvaBankName: invoice.students.provider_dva_bank_name || null,
    lineItems: (invoice.line_items as InvoiceDetail['lineItems']) || [],
    subtotal: Number(invoice.subtotal || 0),
    discountAmount: Number(invoice.discount_amount || 0),
    discountReason: invoice.discount_reason || '',
    previousBalance: Number(invoice.previous_balance || 0),
    totalAmount: total,
    paidAmount: paid,
    outstandingAmount: total - paid,
    status: invoice.status,
    sentAt: invoice.sent_at,
    needsResend: invoice.needs_resend,
    generatedAt: invoice.generated_at,
    fullyPaidAt: invoice.fully_paid_at,
    payments: (payments || []).map((p: any) => {
      const siblings = p.provider_transaction_id ? siblingsByTransaction[p.provider_transaction_id] : undefined
      return {
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        paidAt: p.paid_at,
        reference: p.provider_reference || '',
        // Gateway-driven payments have no staff member to attribute — that's
        // expected, not missing data, so label it instead of a bare dash.
        receivedByName: p.users?.name || (p.provider ? 'Automatic' : null),
        transactionTotal: siblings ? Number(p.amount) + siblings.reduce((s: number, o: any) => s + o.amount, 0) : undefined,
        otherAllocations: siblings,
      }
    }),
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
      discount_reason,
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
        provider_dva_account_number,
        provider_dva_bank_name,
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
    .select('name, logo_url, address_street, address_city, address_state, phone, email, proprietress_title, proprietress_first_name, proprietress_last_name')
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
      schoolLogoUrl: school?.logo_url || null,
      schoolAddress: composeAddress(school?.address_street, school?.address_city, school?.address_state),
      schoolPhone: school?.phone || null,
      schoolEmail: school?.email || null,
      proprietressName: composeProprietressName(school?.proprietress_title, school?.proprietress_first_name, school?.proprietress_last_name),
      // @ts-expect-error
      primaryParentName: invoice.students.families?.primary_parent_name || '',
      // @ts-expect-error
      primaryParentPhone: invoice.students.families?.primary_parent_phone || '',
      // @ts-expect-error
      dvaAccountNumber: invoice.students.provider_dva_account_number || null,
      // @ts-expect-error
      dvaBankName: invoice.students.provider_dva_bank_name || null,
      lineItems: (invoice.line_items as InvoiceDetail['lineItems']) || [],
      subtotal: Number(invoice.subtotal || 0),
      discountAmount: Number(invoice.discount_amount || 0),
      discountReason: invoice.discount_reason || '',
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

// ============ ALL INVOICES (global list, across every term) ============

export interface AllInvoiceRow {
  id: string
  invoiceNumber: string | null
  studentId: string
  studentFirstName: string
  studentLastName: string
  studentAdmissionNumber: string
  className: string
  cycleId: string
  cycleName: string
  cycleStatus: 'draft' | 'active' | 'closed'
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'
  sentAt: string | null
  needsResend: boolean
  generatedAt: string
}

export async function getAllInvoices(): Promise<AllInvoiceRow[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

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
      generated_at,
      students(first_name, last_name, admission_number, classes(name)),
      billing_cycles(id, name, status)
    `)
    .eq('school_id', schoolId)
    .order('generated_at', { ascending: false })

  return (invoiceData || []).map(inv => {
    const total = Number(inv.total_amount)
    const paid = Number(inv.paid_amount || 0)
    return {
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
      // @ts-expect-error — joined
      cycleId: inv.billing_cycles?.id || '',
      // @ts-expect-error — joined
      cycleName: inv.billing_cycles?.name || '',
      // @ts-expect-error — joined
      cycleStatus: inv.billing_cycles?.status || 'closed',
      totalAmount: total,
      paidAmount: paid,
      outstandingAmount: Number(inv.outstanding_amount ?? (total - paid)),
      status: inv.status,
      sentAt: inv.sent_at,
      needsResend: inv.needs_resend,
      generatedAt: inv.generated_at,
    }
  })
}