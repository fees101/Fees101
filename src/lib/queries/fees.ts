import { createClient } from '@/lib/supabase/server'

export async function getFeesOverview() {
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
      activeClasses: 0,
      studentsWithInvoices: 0,
      totalActiveStudents: 0,
      currentTermName: '',
      hasCurrentTerm: false,
    }
  }

  // Get current billing cycle
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .in('status', ['active', 'draft'])
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  // Get active classes count
  const { count: activeClasses } = await supabase
    .from('classes')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('is_active', true)

  // Get active students count
  const { count: totalActiveStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')

  // Get invoice info for current cycle
  let totalExpectedThisTerm = 0
  let studentsWithInvoices = 0

  if (currentCycle) {
    const { data: invoices } = await supabase
      .from('invoices')
      .select('total_amount, student_id')
      .eq('billing_cycle_id', currentCycle.id)

    totalExpectedThisTerm = invoices?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0
    studentsWithInvoices = invoices?.length || 0
  }

  return {
    totalExpectedThisTerm,
    activeClasses: activeClasses || 0,
    studentsWithInvoices,
    totalActiveStudents: totalActiveStudents || 0,
    currentTermName: currentCycle?.name || '',
    hasCurrentTerm: !!currentCycle,
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

  // Get all sections for the dropdown when adding a class
  const { data: sections } = await supabase
    .from('sections')
    .select('id, name')
    .eq('school_id', schoolId)
    .order('display_order')

  // Get all classes (active and inactive) with student count + fee item count
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

  // Get student counts per class (active students only)
  const classIds = classes.map(c => c.id)
  const { data: studentCounts } = await supabase
    .from('students')
    .select('class_id')
    .in('class_id', classIds)
    .eq('status', 'active')

  // Get fee item counts per class
  const { data: feeItemCounts } = await supabase
    .from('fee_items')
    .select('class_id')
    .in('class_id', classIds)

  // Build counts maps
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