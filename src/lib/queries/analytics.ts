import { createClient } from '@/lib/supabase/server'

// Resolve the caller's school, matching the pattern used across the other
// query modules (super_admin with no school_id falls back to the first school).
async function resolveSchoolId(supabase: any): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

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
  return schoolId || null
}

const n = (v: any) => Number(v) || 0

// ---------------------------------------------------------------------------
// Raw per-cycle series. The /payments page is a client-side dashboard: it pulls
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
