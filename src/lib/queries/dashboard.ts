import { createClient } from '@/lib/supabase/server'

export async function getDashboardKPIs() {
  const supabase = await createClient()

  // Get the authenticated user's school_id
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  if (!userProfile) throw new Error('User profile not found')

  // For super_admin, default to first school for now (we'll add school picker later)
  // For school_admin/bursar, use their school_id
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

  // For super_admin, RLS would normally block. We use service role for cross-school queries.
  // For now, super_admin sees school they pick. School admin/bursar restricted by RLS.

  // Get current billing cycle (active or most recent draft)
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .in('status', ['active', 'draft'])
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  // Get all active students count
  const { count: studentsCount } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')

  // Get all invoices for current cycle
  const { data: invoices } = await supabase
    .from('invoices')
    .select('total_amount, paid_amount, status')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', currentCycle?.id || '')

  // Get pending approvals count
  const { count: pendingApprovalsCount } = await supabase
    .from('pending_approvals')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'pending')

  // Calculate totals
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

  // Get current billing cycle
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .in('status', ['active', 'draft'])
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  if (!currentCycle) return []

  // Get classes with display order
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, display_order')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order')

  if (!classes) return []

  // Get invoices joined with students to get class_id
  const { data: invoices } = await supabase
    .from('invoices')
    .select('total_amount, paid_amount, students(class_id)')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', currentCycle.id)

  // Aggregate per class
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
  }).filter(c => c.expected > 0) // Only show classes with invoices

  return classData
}