import { createClient } from '@/lib/supabase/server'

export async function getDashboardKPIs() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  if (!userProfile) throw new Error('User profile not found')

  let schoolId = userProfile.school_id
  if (!schoolId && userProfile.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }

  if (!schoolId) throw new Error('No school context')

  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  const { count: studentsCount } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')

  const { data: invoices } = await supabase
    .from('invoices')
    .select('total_amount, paid_amount, status')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', currentCycle?.id || '')

  const { count: pendingApprovalsCount } = await supabase
    .from('pending_approvals')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'pending')

  const totalExpected = invoices?.reduce((sum, inv) => sum + Number(inv.total_amount), 0) || 0
  const totalCollected = invoices?.reduce((sum, inv) => sum + Number(inv.paid_amount), 0) || 0
  const totalOutstanding = totalExpected - totalCollected
  const collectionPercentage = totalExpected > 0 
    ? Math.round((totalCollected / totalExpected) * 100) 
    : 0

  return {
    currentCycleName: currentCycle?.name || 'No active term',
    studentsCount: studentsCount || 0,
    totalExpected,
    totalCollected,
    totalOutstanding,
    collectionPercentage,
    pendingApprovalsCount: pendingApprovalsCount || 0,
  }
}

export async function getCollectionByClass() {
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
  if (!schoolId) return []

  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  if (!currentCycle) return []

  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, display_order')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order')

  if (!classes) return []

  const { data: invoices } = await supabase
    .from('invoices')
    .select('total_amount, paid_amount, students(class_id)')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', currentCycle.id)

  const classData = classes.map(cls => {
    const classInvoices = invoices?.filter(
      // @ts-expect-error — students is joined object
      (inv) => inv.students?.class_id === cls.id
    ) || []
    
    const expected = classInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0)
    const collected = classInvoices.reduce((sum, inv) => sum + Number(inv.paid_amount), 0)
    const percentage = expected > 0 ? Math.round((collected / expected) * 100) : 0

    return {
      class: cls.name,
      expected,
      collected,
      percentage,
    }
  }).filter(c => c.expected > 0)

  return classData
}

export async function getRecentActivity(limit: number = 7) {
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
  if (!schoolId) return []

  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      id,
      total_amount,
      paid_amount,
      status,
      generated_at,
      fully_paid_at,
      students!inner(
        first_name,
        last_name,
        classes!inner(name),
        families!inner(primary_parent_name)
      )
    `)
    .eq('school_id', schoolId)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (!invoices) return []

  type ActivityEvent = {
    id: string
    type: 'payment' | 'invoice_generated' | 'partial_payment'
    amount?: number
    timestamp: string
    description: string
  }

  const events: ActivityEvent[] = invoices.map((inv) => {
    // @ts-expect-error — joined object
    const studentName = `${inv.students?.first_name || ''} ${inv.students?.last_name || ''}`.trim()
    // @ts-expect-error — joined object
    const className = inv.students?.classes?.name || ''
    // @ts-expect-error — joined object
    const parentName = inv.students?.families?.primary_parent_name || 'family'
    
    if (inv.status === 'paid' && inv.fully_paid_at) {
      return {
        id: inv.id,
        type: 'payment' as const,
        amount: Number(inv.paid_amount),
        timestamp: inv.fully_paid_at,
        description: `Payment received from ${parentName} for ${studentName} (${className})`,
      }
    }

    if (inv.status === 'partial' && Number(inv.paid_amount) > 0) {
      return {
        id: inv.id,
        type: 'partial_payment' as const,
        amount: Number(inv.paid_amount),
        timestamp: inv.generated_at,
        description: `Payment received from ${parentName} for ${studentName} (${className})`,
      }
    }

    return {
      id: inv.id,
      type: 'invoice_generated' as const,
      amount: Number(inv.total_amount),
      timestamp: inv.generated_at,
      description: `Invoice sent to ${parentName} for ${studentName} (${className})`,
    }
  })

  return events.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
}