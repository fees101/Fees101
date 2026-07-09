import { createClient } from '@/lib/supabase/server'
import { getCollectedForDateRange } from './fees'

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
    .select('id, name, start_date, end_date')
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
    .select('total_amount, paid_amount, outstanding_amount, credit_applied, status')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', currentCycle?.id || '')

  const { count: pendingApprovalsCount } = await supabase
    .from('pending_approvals')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'pending')

  // Expected = gross fees for the term = net total plus whatever credit
  // covered part of it (total_amount is already net of credit_applied).
  // Must match the definition used by getCollectionByClass / getAllCycles /
  // getCycleDetailById / getFeesOverview, or this KPI tile silently disagrees
  // with the collection-by-class chart on the same dashboard.
  const totalExpected = invoices?.reduce((sum, inv) => sum + Number(inv.total_amount) + Number(inv.credit_applied || 0), 0) || 0
  // Outstanding is what's still genuinely owed on these invoices — an
  // allocation concept, independent of when any of it was actually paid.
  const totalOutstanding = invoices?.reduce((sum, inv) => sum + Number(inv.outstanding_amount ?? (Number(inv.total_amount) - Number(inv.paid_amount))), 0) || 0
  // Collected = real money received while this term was active, by payment
  // date — not what's allocated to this term's invoices. Can legitimately
  // exceed or fall short of totalExpected; it's not "expected - outstanding."
  const totalCollected = currentCycle
    ? await getCollectedForDateRange(supabase, schoolId, currentCycle.start_date, currentCycle.end_date)
    : 0
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
    .select('id, start_date, end_date')
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
    .select('total_amount, paid_amount, credit_applied, students(class_id)')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', currentCycle.id)

  // "Collected" here is deliberately cash-received-by-date, not
  // invoice-allocation — same rule as the school's Total Collected KPI. A
  // class where families sent more than that term's fees should be able to
  // show over 100%, the same way an individual overpaying student can; an
  // invoice-based sum can never exceed what's owed (any excess always rolls
  // to the next term's invoice or sits as credit), which made this always
  // cap at 100% even when a class genuinely collected more than required —
  // reading as "nobody ever overpays," which isn't true and isn't what a
  // school asking "did we collect enough" wants to see.
  const endExclusive = new Date(currentCycle.end_date)
  endExclusive.setDate(endExclusive.getDate() + 1)
  const { data: payments } = await supabase
    .from('payments')
    .select('amount, paid_at, students(class_id)')
    .eq('school_id', schoolId)
    .eq('match_status', 'matched')
    .gte('paid_at', currentCycle.start_date)
    .lt('paid_at', endExclusive.toISOString())

  const { data: studentCounts } = await supabase
    .from('students')
    .select('class_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')

  const classData = classes.map(cls => {
    const classInvoices = invoices?.filter(
      // @ts-expect-error — students is joined object
      (inv) => inv.students?.class_id === cls.id
    ) || []
    const classPayments = payments?.filter(
      // @ts-expect-error — students is joined object
      (p) => p.students?.class_id === cls.id
    ) || []

    // invoices.total_amount is already NET of credit_applied (computeInvoiceForStudent
    // sets total = amountDue - creditApplied), so "expected" — the gross amount
    // actually owed before any credit covered part of it — has to add that
    // credit back. Using total_amount alone here would understate expected.
    const expected = classInvoices.reduce((sum, inv) => sum + Number(inv.total_amount) + Number(inv.credit_applied || 0), 0)
    const collected = classPayments.reduce((sum, p) => sum + Number(p.amount), 0)
    // Outstanding stays invoice-based on purpose — independent of the
    // date-based collected figure, same reasoning as the dashboard KPI.
    const outstanding = classInvoices.reduce((sum, inv) => sum + Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount)), 0)
    const percentage = expected > 0 ? Math.round((collected / expected) * 100) : 0
    const studentCount = studentCounts?.filter(s => s.class_id === cls.id).length || 0

    return {
      class: cls.name,
      studentCount,
      invoicedCount: classInvoices.length,
      expected,
      collected,
      outstanding,
      percentage,
    }
  }).filter(c => c.expected > 0)
  // classes was already fetched ordered by display_order — map() preserves it.

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

  // One event per real payment transaction, not per invoice's current
  // status. Deriving events from invoices (as this used to) shows only the
  // invoice's latest state — a parent who sent two separate transfers that
  // together paid off an invoice would show up as a single summarized
  // "payment received" line for the final amount, with the earlier transfer
  // invisible. Reading from payments directly preserves each transfer as
  // its own event, in the order it actually happened.
  const { data: payments } = await supabase
    .from('payments')
    .select(`
      id,
      amount,
      paid_at,
      students!inner(
        first_name,
        last_name,
        classes!inner(name),
        families!inner(primary_parent_name)
      )
    `)
    .eq('school_id', schoolId)
    .eq('match_status', 'matched')
    .order('paid_at', { ascending: false })
    .limit(limit)

  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      id,
      total_amount,
      generated_at,
      students!inner(
        first_name,
        last_name,
        classes!inner(name),
        families!inner(primary_parent_name)
      )
    `)
    .eq('school_id', schoolId)
    .order('generated_at', { ascending: false })
    .limit(limit)

  type ActivityEvent = {
    id: string
    type: 'payment' | 'invoice_generated'
    amount?: number
    timestamp: string
    description: string
  }

  const paymentEvents: ActivityEvent[] = (payments || []).map((p) => {
    // @ts-expect-error — joined object
    const studentName = `${p.students?.first_name || ''} ${p.students?.last_name || ''}`.trim()
    // @ts-expect-error — joined object
    const className = p.students?.classes?.name || ''
    // @ts-expect-error — joined object
    const parentName = p.students?.families?.primary_parent_name || 'family'
    return {
      id: p.id,
      type: 'payment' as const,
      amount: Number(p.amount),
      timestamp: p.paid_at,
      description: `Payment received from ${parentName} for ${studentName} (${className})`,
    }
  })

  const invoiceEvents: ActivityEvent[] = (invoices || []).map((inv) => {
    // @ts-expect-error — joined object
    const studentName = `${inv.students?.first_name || ''} ${inv.students?.last_name || ''}`.trim()
    // @ts-expect-error — joined object
    const className = inv.students?.classes?.name || ''
    // @ts-expect-error — joined object
    const parentName = inv.students?.families?.primary_parent_name || 'family'
    return {
      id: inv.id,
      type: 'invoice_generated' as const,
      amount: Number(inv.total_amount),
      timestamp: inv.generated_at,
      description: `Invoice sent to ${parentName} for ${studentName} (${className})`,
    }
  })

  const events = [...paymentEvents, ...invoiceEvents]

  return events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}