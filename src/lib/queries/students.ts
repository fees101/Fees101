import { createClient } from '@/lib/supabase/server'

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
  }

  // Get invoices for current cycle
  const studentIds = students.map(s => s.id)
  const { data: invoices } = await supabase
    .from('invoices')
    .select('student_id, total_amount, paid_amount, status')
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
      invoiceTotal: invoice ? Number(invoice.total_amount) : 0,
      invoicePaid: invoice ? Number(invoice.paid_amount) : 0,
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

  // Get current billing cycle
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .in('status', ['active', 'draft'])
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
      .select('id, amount, method, paid_at, paystack_reference')
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

  // Verify student belongs to this school
  const { data: student } = await supabase
    .from('students')
    .select('id')
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
      paystack_reference,
      invoice_id
    `)
    .eq('student_id', studentId)
    .eq('match_status', 'matched')
    .order('paid_at', { ascending: false })

  // Compute summary numbers
  const totalInvoiced = invoices?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0
  const totalPaid = invoices?.reduce((sum, inv) => sum + Number(inv.paid_amount), 0) || 0
  const outstanding = totalInvoiced - totalPaid
  const termsInvoiced = invoices?.length || 0

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
    reference: p.paystack_reference || '',
    appliedTo: p.invoice_id ? invoiceLookup.get(p.invoice_id) || 'Unknown term' : 'Unassigned',
  })) || []

  return {
    summary: {
      totalInvoiced,
      totalPaid,
      outstanding,
      termsInvoiced,
    },
    invoices: formattedInvoices,
    payments: formattedPayments,
  }
}