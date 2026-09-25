import { getAuthContext } from '@/lib/auth/permissions'
import { getCollectedForDateRange } from './fees'

export async function getDashboardKPIs() {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId, userId } = ctx
  if (!schoolId) throw new Error('No school context')

  // Overdue = past due for more than two weeks. Compared against the term's
  // payment due_date (a date column), so a plain YYYY-MM-DD cutoff string
  // compares correctly.
  const cutoff14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)

  const [
    { data: currentCycle },
    { count: studentsCount },
    { data: pendingDiscounts },
    { count: myPendingRequestsCount },
    { data: needsResendRows },
    { data: overdueRows },
  ] = await Promise.all([
    supabase
      .from('billing_cycles')
      // due_date drives overdue/close reasoning; end_date is the term close.
      .select('id, name, start_date, end_date, due_date')
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
    // that table). Left-join the invoice subtotal so we can estimate the naira
    // at stake; a left join keeps the row (and the count) even if the invoice
    // link is missing.
    supabase
      .from('discounts')
      .select('amount, is_percentage, invoices(subtotal)')
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
    // to just the current cycle. Selecting the amounts (not head:true) so the
    // "money at stake" figure comes from the same rows as the count.
    supabase
      .from('invoices')
      .select('outstanding_amount, total_amount')
      .eq('school_id', schoolId)
      .eq('needs_resend', true)
      // A cancelled invoice can carry a stale needs_resend flag from before
      // it was cancelled — it's a dead record, never worth resending.
      .neq('status', 'cancelled'),
    // Invoices overdue past 14 days, school-wide: still owing, on a term whose
    // payment due_date passed more than two weeks ago.
    supabase
      .from('invoices')
      .select('outstanding_amount, billing_cycles!inner(due_date)')
      .eq('school_id', schoolId)
      .neq('status', 'cancelled')
      .gt('outstanding_amount', 0)
      .lt('billing_cycles.due_date', cutoff14),
  ])

  // invoices + collected both depend on currentCycle, so they run after it.
  const [{ data: invoices }, totalCollected] = await Promise.all([
    supabase
      .from('invoices')
      .select('total_amount, paid_amount, outstanding_amount, credit_applied, status, student_id, students(status)')
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

  // Count invoices and billed students on the same basis the cycle-detail page
  // and the generator use, so the three never disagree for a single term:
  //  - "Invoices issued" = every invoice row for the term (a cancelled invoice
  //    was still issued; the cycle page counts it and lists it too).
  //  - "Students billed" / "no invoice this term" = *active* students who hold
  //    an invoice of any status. A cancelled invoice is deliberate and sticky —
  //    the generator treats that student as already invoiced and won't re-issue,
  //    so they are billed, not "missing". Only active students count, so a
  //    withdrawn student's stray invoice can't push billed past the active roll.
  const invoicesIssued = (invoices || []).length
  const billedStudentIds = new Set(
    (invoices || [])
      .filter((inv: any) => inv.students?.status === 'active')
      .map((inv: any) => inv.student_id)
  )
  const studentsBilled = billedStudentIds.size
  const unbilledCount = Math.max(0, (studentsCount || 0) - studentsBilled)

  // needs-resend: count + the naira still owed on those invoices.
  const needsResendCount = (needsResendRows || []).length
  const needsResendAmount = (needsResendRows || []).reduce(
    (sum, inv) => sum + Number(inv.outstanding_amount ?? inv.total_amount ?? 0), 0)

  // overdue past 14 days: count + naira still owed.
  const overdue14Count = (overdueRows || []).length
  const overdue14Amount = (overdueRows || []).reduce(
    (sum, inv) => sum + Number(inv.outstanding_amount ?? 0), 0)

  // pending discount approvals: count + estimated naira at stake. A percentage
  // discount is estimated against the invoice subtotal (ignores any
  // non-discountable items, so it reads as an upper-bound estimate); a flat
  // discount is its own amount.
  const pendingApprovalsCount = (pendingDiscounts || []).length
  const pendingApprovalsAmount = (pendingDiscounts || []).reduce((sum, d) => {
    // @ts-expect-error — joined object
    const subtotal = Number(d.invoices?.subtotal || 0)
    const amount = Number(d.amount || 0)
    return sum + (d.is_percentage ? (subtotal * amount) / 100 : amount)
  }, 0)

  // Coarse term-level overdue split: without a per-invoice due date, the whole
  // outstanding balance counts as overdue once the term's payment due_date has
  // passed, otherwise it's all due later. Honest given the schema, and it
  // matches the single close date shown alongside it.
  const today = new Date().toISOString().slice(0, 10)
  const termPastDue = currentCycle?.due_date ? currentCycle.due_date < today : false
  const overdueAmount = termPastDue ? totalOutstanding : 0
  const dueLaterAmount = totalOutstanding - overdueAmount

  const closeDate = currentCycle?.end_date || null
  let daysToClose: number | null = null
  if (closeDate) {
    daysToClose = Math.max(0, Math.ceil((new Date(closeDate).getTime() - Date.now()) / 86400000))
  }

  return {
    currentCycleName: currentCycle?.name || null,
    studentsCount: studentsCount || 0,
    totalExpected,
    totalCollected,
    totalOutstanding,
    collectionPercentage,
    overdueAmount,
    dueLaterAmount,
    closeDate,
    daysToClose,
    invoicesIssued,
    studentsBilled,
    unbilledCount,
    needsResendCount,
    needsResendAmount,
    overdue14Count,
    overdue14Amount,
    pendingApprovalsCount,
    pendingApprovalsAmount,
    myPendingRequestsCount: myPendingRequestsCount || 0,
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

  // Same per-cycle GROUP BY the /money/collections analytics page uses (see
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

// showFinancials mirrors the see-financial-totals check the caller (dashboard
// page) already made for its own hero panel — the event itself ("payment
// received from X") still shows either way, only the naira figure drops from
// the line, matching the "item shows, only the amount redacts" convention
// used for the dashboard's "Needs you" queue.
export async function getRecentActivity(limit: number = 7, showFinancials: boolean = false) {
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
    // The person the event is about (payer / billed family), shown bold.
    name: string
    // The coloured second line: green for money received, neutral otherwise.
    line: string
    tone: 'ledger' | 'neutral'
    timestamp: string
  }

  const paymentEvents: ActivityEvent[] = (payments || []).map((p) => {
    // @ts-expect-error — joined object
    const parentName = p.students?.families?.primary_parent_name || 'Family'
    return {
      id: p.id,
      type: 'payment' as const,
      name: parentName,
      line: showFinancials ? `₦${Number(p.amount).toLocaleString('en-NG')} received` : 'Payment received',
      tone: 'ledger' as const,
      timestamp: p.paid_at,
    }
  })

  const invoiceEvents: ActivityEvent[] = (invoices || []).map((inv) => {
    // @ts-expect-error — joined object
    const studentName = `${inv.students?.first_name || ''} ${inv.students?.last_name || ''}`.trim()
    // @ts-expect-error — joined object
    const className = inv.students?.classes?.name || ''
    return {
      id: inv.id,
      type: 'invoice_generated' as const,
      name: studentName || 'Student',
      line: className ? `Invoice issued · ${className}` : 'Invoice issued',
      tone: 'neutral' as const,
      timestamp: inv.generated_at,
    }
  })

  const events = [...paymentEvents, ...invoiceEvents]

  return events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
}