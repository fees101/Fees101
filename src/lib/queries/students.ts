import { createClient } from '@/lib/supabase/server'

export async function getStudents() {
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
  if (!schoolId) return { students: [], classes: [], currentTermName: '', classCount: 0 }

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

  // Get all students with class and family info
  const { data: students } = await supabase
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
    .order('last_name')

  if (!students) return { 
    students: [], 
    classes: classes || [], 
    currentTermName: currentCycle?.name || '',
    classCount: classes?.length || 0,
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