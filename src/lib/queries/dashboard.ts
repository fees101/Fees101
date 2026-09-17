import { getAuthContext } from '@/lib/auth/permissions'
import { getCollectedForDateRange } from './fees'

export async function getDashboardKPIs() {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId, userId } = ctx
  if (!schoolId) throw new Error('No school context')

  const [
    { data: currentCycle },
    { count: studentsCount },
    { count: pendingApprovalsCount },
    { count: myPendingRequestsCount },
    { count: needsResendCount },
  ] = await Promise.all([
    supabase
      .from('billing_cycles')
      .select('id, name, start_date, end_date')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('status', 'active'),
    // Pending discount requests, sourced from the real discounts table (not the
    // disconnected/unused pending_approvals queue — nothing ever inserts into
    // that table). Two counts: how many need THIS user's review (only
    // meaningful for approvers) vs. how many THIS user is themselves waiting on.
    supabase
      .from('discounts')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('status', 'pending'),
    supabase
      .from('discounts')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('status', 'pending')
      .eq('requested_by', userId),
    // School-wide, term-independent — a stale invoice in an older still-open
    // term is exactly the kind of thing that gets missed if this were scoped
    // to just the current cycle.
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('needs_resend', true)
      // A cancelled invoice can carry a stale needs_resend flag from before
      // it was cancelled — it's a dead record, never worth resending.
      .neq('status', 'cancelled'),
  ])

  // invoices + collected both depend on currentCycle, so they run after it.
  const [{ data: invoices }, totalCollected] = await Promise.all([
    supabase
      .from('invoices')
      .select('total_amount, paid_amount, outstanding_amount, credit_applied, status')
      .eq('school_id', schoolId)
      .eq('billing_cycle_id', currentCycle?.id || ''),
    // Collected = real money received while this term was active, by payment
    // date — not what's allocated to this term's invoices. Can legitimately
    // exceed or fall short of totalExpected; it's not "expected - outstanding."
    currentCycle
      ? getCollectedForDateRange(supabase, schoolId, currentCycle.start_date, currentCycle.end_date)
      : Promise.resolve(0),
  ])
  // covered part of it (total_amount is already net of credit_applied).
  // Must match the definition used by getCollectionByClass / getAllCycles /
  // getCycleDetailById / getFeesOverview, or this KPI tile silently disagrees
  // with the collection-by-class chart on the same dashboard.
  // A cancelled invoice (e.g. a withdrawn student's stray term invoice)
  // owes nothing — excluded so it doesn't inflate either figure.
  const liveInvoices = (invoices || []).filter(inv => inv.status !== 'cancelled')
  const totalExpected = liveInvoices.reduce((sum, inv) => sum + Number(inv.total_amount) + Number(inv.credit_applied || 0), 0)
  // Outstanding is what's still genuinely owed on these invoices — an
  // allocation concept, independent of when any of it was actually paid.
  const totalOutstanding = liveInvoices.reduce((sum, inv) => sum + Number(inv.outstanding_amount ?? (Number(inv.total_amount) - Number(inv.paid_amount))), 0)
  const collectionPercentage = totalExpected > 0
    ? Math.round((totalCollected / totalExpected) * 100)
    : 0

  return {
    currentCycleName: currentCycle?.name || null,
    studentsCount: studentsCount || 0,
    totalExpected,
    totalCollected,
    totalOutstanding,
    collectionPercentage,
    pendingApprovalsCount: pendingApprovalsCount || 0,
    myPendingRequestsCount: myPendingRequestsCount || 0,
    needsResendCount: needsResendCount || 0,
  }
}

export async function getCollectionByClass() {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx
  if (!schoolId) return []

  const [{ data: currentCycle }, { data: classes }, { data: studentCounts }] = await Promise.all([
    supabase
      .from('billing_cycles')
      .select('id, start_date, end_date')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('classes')
      .select('id, name, display_order')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('students')
      .select('class_id')
      .eq('school_id', schoolId)
      .eq('status', 'active'),
  ])

  if (!currentCycle) return []
  if (!classes) return []

  // Same per-cycle GROUP BY the /payments analytics page uses (see
  // analytics_class_series in db/analytics_functions.sql), filtered here to
  // the active cycle. Note this makes "collected" invoice-based (paid_amount +
  // credit_applied), not the date-based cash-received figure this used to
  // compute from the payments table — it can no longer read over 100% the way
  // the school-wide Total Collected KPI can, since an invoice's paid_amount is
  // capped by what it billed (any excess rolls to the next term as credit).
  const { data: classRows } = await supabase.rpc('analytics_class_series', { p_school_id: schoolId })
  const cycleRows = (classRows || []).filter((r: any) => r.cycle_id === currentCycle.id)
  const byClassName = new Map<string, any>(cycleRows.map((r: any) => [r.class_name, r]))

  const classData = classes.map(cls => {
    const row = byClassName.get(cls.name)
    const expected = Number(row?.billed) || 0
    const collected = Number(row?.collected) || 0
    const outstanding = Number(row?.outstanding) || 0
    const invoicedCount = Number(row?.students_billed) || 0
    const percentage = expected > 0 ? Math.round((collected / expected) * 100) : 0
    const studentCount = studentCounts?.filter(s => s.class_id === cls.id).length || 0

    return {
      class: cls.name,
      studentCount,
      invoicedCount,
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
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx
  if (!schoolId) return []

  // One event per real payment transaction, not per invoice's current
  // status. Deriving events from invoices (as this used to) shows only the
  // invoice's latest state — a parent who sent two separate transfers that
  // together paid off an invoice would show up as a single summarized
  // "payment received" line for the final amount, with the earlier transfer
  // invisible. Reading from payments directly preserves each transfer as
  // its own event, in the order it actually happened.
  const [{ data: payments }, { data: invoices }] = await Promise.all([
    supabase
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
      .limit(limit),
    supabase
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
      .limit(limit),
  ])

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