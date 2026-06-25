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
      .in('status', ['active', 'draft'])
      .order('start_date', { ascending: false })
      .limit(1)
      .single()
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
      .in('status', ['active', 'draft'])
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