import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

// Resolve the caller's school from the auth context. The `supabase` arg is
// kept for call-site symmetry with the other query helpers even though the
// school id comes from getAuthContext(), not a separate lookup.
async function resolveSchoolId(supabase: any): Promise<string | null> {
  const ctx = await getAuthContext()
  return ctx?.schoolId ?? null
}

const n = (v: any) => Number(v) || 0

// ---------------------------------------------------------------------------
// Raw per-cycle series. The /money/collections page is a client-side dashboard: it pulls
// these small per-cycle rows once and does ALL scoping/aggregation/comparison
// in the browser (brush a range, overlay periods, hover for detail) with no
// round-trips. See src/lib/analytics/aggregate.ts for the aggregation helpers.
// ---------------------------------------------------------------------------

export interface TermPoint {
  cycleId: string
  cycleName: string
  startDate: string
  sessionId: string | null
  sessionName: string | null
  status: string
  invoiceCount: number
  billed: number
  collected: number
  outstanding: number
  discountTotal: number
  grossPotential: number
}

export interface FeeCyclePoint {
  cycleId: string
  cycleName: string
  startDate: string
  name: string
  kind: 'required' | 'opt_in'
  studentsBilled: number
  billed: number
  collected: number
}

export interface DiscountCyclePoint {
  cycleId: string
  category: string
  discountCount: number
  studentCount: number
  estAmount: number
}

export interface ClassCyclePoint {
  cycleId: string
  className: string
  studentsBilled: number
  billed: number
  collected: number
  outstanding: number
}

export interface FeeClassPoint {
  cycleId: string
  cycleName: string
  startDate: string
  name: string
  kind: 'required' | 'opt_in'
  className: string
  studentsBilled: number
  billed: number
  price: number
}

export interface AnalyticsBundle {
  ready: boolean            // false if the DB functions aren't installed yet
  error?: string
  hasData: boolean          // false if there are no cycles at all
  termSeries: TermPoint[]
  feeSeries: FeeCyclePoint[]
  discountSeries: DiscountCyclePoint[]
  classSeries: ClassCyclePoint[]
  feeClassSeries: FeeClassPoint[]  // empty if analytics_fee_class_series isn't installed yet
}

const EMPTY: AnalyticsBundle = {
  ready: true, hasData: false,
  termSeries: [], feeSeries: [], discountSeries: [], classSeries: [], feeClassSeries: [],
}

// Aggregation is done DB-side (see db/analytics_functions.sql) which returns a
// small per-cycle row set; the client then rolls those up for whatever the user
// selects. Keeps the DB calls to a fixed 4 no matter the history size.
export async function getAnalyticsBundle(): Promise<AnalyticsBundle> {
  const supabase = await createClient()
  const schoolId = await resolveSchoolId(supabase)
  if (!schoolId) return EMPTY

  const { data: terms, error: termErr } = await supabase.rpc('analytics_term_series', { p_school_id: schoolId })

  // If the RPC is missing, the migration hasn't been run yet — surface a clear
  // message instead of crashing the page.
  if (termErr) return { ...EMPTY, ready: false, error: termErr.message }

  const termSeries: TermPoint[] = (terms || []).map((t: any) => ({
    cycleId: t.cycle_id,
    cycleName: t.cycle_name,
    startDate: t.start_date,
    sessionId: t.session_id,
    sessionName: t.session_name,
    status: t.status,
    invoiceCount: n(t.invoice_count),
    billed: n(t.billed),
    collected: n(t.collected),
    outstanding: n(t.outstanding),
    discountTotal: n(t.discount_total),
    grossPotential: n(t.gross_potential),
  }))

  if (termSeries.length === 0) return EMPTY

  const [{ data: feeRows }, { data: discRows }, { data: classRows }, feeClassRes] = await Promise.all([
    supabase.rpc('analytics_fee_series', { p_school_id: schoolId }),
    supabase.rpc('analytics_discount_series', { p_school_id: schoolId }),
    supabase.rpc('analytics_class_series', { p_school_id: schoolId }),
    supabase.rpc('analytics_fee_class_series', { p_school_id: schoolId }),
  ])

  const feeSeries: FeeCyclePoint[] = (feeRows || []).map((f: any) => ({
    cycleId: f.cycle_id,
    cycleName: f.cycle_name,
    startDate: f.start_date,
    name: f.fee_name,
    kind: (f.kind === 'opt_in' ? 'opt_in' : 'required'),
    studentsBilled: n(f.students_billed),
    billed: n(f.billed),
    collected: Math.round(n(f.collected_est)),
  }))

  const discountSeries: DiscountCyclePoint[] = (discRows || []).map((d: any) => ({
    cycleId: d.cycle_id,
    category: d.category,
    discountCount: n(d.discount_count),
    studentCount: n(d.student_count),
    estAmount: n(d.est_amount),
  }))

  const classSeries: ClassCyclePoint[] = (classRows || []).map((c: any) => ({
    cycleId: c.cycle_id,
    className: c.class_name,
    studentsBilled: n(c.students_billed),
    billed: n(c.billed),
    collected: n(c.collected),
    outstanding: n(c.outstanding),
  }))

  // Additive: absent on installs that predate analytics_fee_class_series. Its
  // error is non-fatal — the fee-price chart just shows an empty state until the
  // updated db/analytics_functions.sql is re-run.
  const feeClassSeries: FeeClassPoint[] = (feeClassRes?.data || []).map((f: any) => ({
    cycleId: f.cycle_id,
    cycleName: f.cycle_name,
    startDate: f.start_date,
    name: f.fee_name,
    kind: (f.kind === 'opt_in' ? 'opt_in' : 'required'),
    className: f.class_name,
    studentsBilled: n(f.students_billed),
    billed: n(f.billed),
    price: n(f.price),
  }))

  return { ready: true, hasData: true, termSeries, feeSeries, discountSeries, classSeries, feeClassSeries }
}

// Server-side redaction for a caller who holds see-analytics but not
// see-financial-totals. PaymentsDashboard is a client component and this
// bundle becomes its props, so masking only in the render layer (the amt()
// helpers there) still puts real billed/collected/discountTotal/price naira
// figures into the RSC payload — readable from devtools/network regardless of
// what's drawn on screen. Zeroing the money fields here, before the bundle
// ever reaches the client, closes that. Non-money fields (names, counts,
// dates, status) are left alone, matching the "item shows, only the naira
// figure redacts" convention used elsewhere.
//
// Trade-off: rate/percentage visuals that this dashboard computes client-side
// from these same fields (collection rate, per-fee/class rate, the billed-vs-
// collected bar heights, the fee price-fan lines) are derived from the exact
// numbers zeroed here, so they flatten to 0/blank for this permission
// combination rather than continuing to show relative shape without exact
// figures. Preserving those would need the client-side range-brushing/compare
// aggregation (src/lib/analytics/aggregate.ts) to work off pre-computed
// ratios instead of raw per-cycle sums — a larger change than this pass.
export function redactAnalyticsBundle(bundle: AnalyticsBundle): AnalyticsBundle {
  return {
    ...bundle,
    termSeries: bundle.termSeries.map(t => ({
      ...t, billed: 0, collected: 0, outstanding: 0, discountTotal: 0, grossPotential: 0,
    })),
    feeSeries: bundle.feeSeries.map(f => ({ ...f, billed: 0, collected: 0 })),
    discountSeries: bundle.discountSeries.map(d => ({ ...d, estAmount: 0 })),
    classSeries: bundle.classSeries.map(c => ({ ...c, billed: 0, collected: 0, outstanding: 0 })),
    feeClassSeries: bundle.feeClassSeries.map(f => ({ ...f, billed: 0, price: 0 })),
  }
}

// ---------------------------------------------------------------------------
// Drill-down: the underlying students behind a fee/class row on the /money/collections
// page, scoped to the cycle(s) currently selected there. Queries the
// already-RLS-scoped invoices/students tables directly rather than a new RPC
// — there's no cross-cycle aggregation here, just a filtered row list.
// ---------------------------------------------------------------------------

export interface DrilldownRow {
  studentId: string
  studentName: string
  className: string
  amountOwed: number
  amountPaid: number
  status: string
}

function studentName(inv: any): string {
  return `${inv.students?.first_name || ''} ${inv.students?.last_name || ''}`.trim()
}

export async function getClassDrilldown(cycleIds: string[], className: string): Promise<DrilldownRow[]> {
  const supabase = await createClient()
  const schoolId = await resolveSchoolId(supabase)
  if (!schoolId || cycleIds.length === 0) return []

  const { data } = await supabase
    .from('invoices')
    .select('student_id, total_amount, paid_amount, credit_applied, status, students(first_name, last_name, classes(name))')
    .eq('school_id', schoolId)
    .in('billing_cycle_id', cycleIds)
    .neq('status', 'cancelled')

  return (data || [])
    .filter((inv: any) => (inv.students?.classes?.name || 'Unassigned') === className)
    .map((inv: any) => ({
      studentId: inv.student_id,
      studentName: studentName(inv),
      className,
      amountOwed: Number(inv.total_amount) + Number(inv.credit_applied || 0),
      amountPaid: Number(inv.paid_amount || 0) + Number(inv.credit_applied || 0),
      status: inv.status,
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName))
}

export async function getFeeDrilldown(cycleIds: string[], feeName: string): Promise<DrilldownRow[]> {
  const supabase = await createClient()
  const schoolId = await resolveSchoolId(supabase)
  if (!schoolId || cycleIds.length === 0) return []

  const { data } = await supabase
    .from('invoices')
    .select('student_id, total_amount, paid_amount, outstanding_amount, status, line_items, students(first_name, last_name, classes(name))')
    .eq('school_id', schoolId)
    .in('billing_cycle_id', cycleIds)
    .neq('status', 'cancelled')

  const rows: DrilldownRow[] = []
  for (const inv of (data || []) as any[]) {
    const line = (inv.line_items || []).find(
      (li: any) => li?.name === feeName && (li?.kind === 'required' || li?.kind === 'opt_in')
    )
    if (!line) continue
    const lineAmount = Number(line.amount) || 0
    const total = Number(inv.total_amount)
    // Same proportional allocation as analytics_fee_series' collected_est
    // (db/analytics_functions.sql) — money is fungible across an invoice's
    // lines, so a per-line paid amount is an estimate, not a real figure.
    const paidFraction = Number(inv.outstanding_amount) <= 0 ? 1 : total <= 0 ? 0 : Math.min(1, Number(inv.paid_amount) / total)
    rows.push({
      studentId: inv.student_id,
      studentName: studentName(inv),
      className: inv.students?.classes?.name || 'Unassigned',
      amountOwed: lineAmount,
      amountPaid: Math.round(lineAmount * paidFraction),
      status: inv.status,
    })
  }
  return rows.sort((a, b) => a.studentName.localeCompare(b.studentName))
}
