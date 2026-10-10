import { createServiceRoleClient } from './supabase/serviceRole'

// Daily pro-rata accrual engine for the v2 platform billing model
// (decided 2026-09-29, see db/platform_billing_model.sql):
//
//   Price ₦500/student/month, billed as a DAILY pro-rata amount. On a
//   billable day: accrued = active_student_count × (price_per_student_month / 30),
//   rounded to 2dp. On a non-billable (free-window) day: accrued = 0.
//
//   Recurring cycle anchored to platform_billing.onboarding_at: every 365-day
//   cycle since onboarding starts with 65 FREE days, then 300 BILLED days.
//
// All snapshots are taken off the SERVER date (the cron's run date), never a
// school-supplied date — that's the anti-gaming property from the schema.

const MS_PER_DAY = 86_400_000
const CYCLE_DAYS = 365
const FREE_DAYS = 65 // first 65 days of each cycle are free
// BILLED_DAYS = CYCLE_DAYS - FREE_DAYS = 300 (the remainder of the cycle)
const DAYS_IN_MONTH_FOR_PRORATA = 30 // model divides the monthly price by a flat 30

// Round to 2 decimal places (kobo-safe naira). Flagged design default: 2dp.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Normalise a Date to the ms of its UTC midnight, so day arithmetic is a clean
// integer count of calendar days and never drifts by ±1 from a time-of-day
// component. Both the cron run date and onboarding_at are collapsed this way.
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// Format a Date as YYYY-MM-DD in UTC — matches how a `date` column round-trips
// and keeps the cron's usage_date deterministic regardless of server TZ.
function formatDate(d: Date): string {
  return new Date(utcMidnight(d)).toISOString().slice(0, 10)
}

export interface CycleState {
  billable: boolean
  dayIndex: number // whole days since onboarding (can be <0 if onboarding is in the future)
  phaseDay: number // 0..364 position within the current 365-day cycle
  daysUntilPhaseChange: number // days left in the current phase (free→billed, or cycle reset)
}

// The 65-free / 300-billed cycle logic. `onDate` is the day being evaluated
// (the cron's server date for a snapshot).
export function cycleBillable(onboardingAt: string, onDate: Date): CycleState {
  const dayIndex = Math.floor((utcMidnight(onDate) - utcMidnight(new Date(onboardingAt))) / MS_PER_DAY)

  // Safe modulo (JS % keeps the sign of the dividend) so a future onboarding
  // date still yields a phaseDay in [0, 364].
  const phaseDay = ((dayIndex % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS

  // Not yet onboarded (onboarding in the future) → treat as free, not billable.
  const billable = dayIndex >= 0 && phaseDay >= FREE_DAYS

  const daysUntilPhaseChange =
    phaseDay < FREE_DAYS
      ? FREE_DAYS - phaseDay // days left in the free window before billing begins
      : CYCLE_DAYS - phaseDay // days left in the billed window before the cycle resets to free

  return { billable, dayIndex, phaseDay, daysUntilPhaseChange }
}

// Snapshot one day of usage for every billing-enabled school. Idempotent:
// re-running for the same date overwrites the existing (school_id, usage_date)
// row rather than duplicating it (design default: a day already snapshotted is
// overwritten). Uses the service-role client.
export async function snapshotDailyUsage(onDate: Date = new Date()): Promise<{ schoolsProcessed: number }> {
  const supabase = createServiceRoleClient()
  const usageDate = formatDate(onDate)

  // Only schools that have started billing (onboarding_at set) get usage rows.
  const { data: billingRows } = await supabase
    .from('platform_billing')
    .select('school_id, onboarding_at, price_per_student_month')
    .not('onboarding_at', 'is', null)

  if (!billingRows || billingRows.length === 0) {
    return { schoolsProcessed: 0 }
  }

  // Active-student count per school = rows in the main `students` table with
  // status='active' (same definition getSchoolsOverview uses). One pass, tallied.
  const { data: students } = await supabase.from('students').select('school_id').eq('status', 'active')
  const activeBySchool = new Map<string, number>()
  ;(students || []).forEach(s => {
    activeBySchool.set(s.school_id, (activeBySchool.get(s.school_id) || 0) + 1)
  })

  const rows = billingRows.map(b => {
    const activeStudentCount = activeBySchool.get(b.school_id) || 0
    const { billable } = cycleBillable(b.onboarding_at as string, onDate)
    const pricePerMonth = Number(b.price_per_student_month ?? 500)
    const accruedAmount = billable
      ? round2(activeStudentCount * (pricePerMonth / DAYS_IN_MONTH_FOR_PRORATA))
      : 0

    return {
      school_id: b.school_id,
      usage_date: usageDate,
      active_student_count: activeStudentCount,
      billable,
      accrued_amount: accruedAmount,
    }
  })

  // Bulk upsert on the (school_id, usage_date) unique constraint → idempotent.
  const { error } = await supabase
    .from('platform_daily_usage')
    .upsert(rows, { onConflict: 'school_id,usage_date' })

  if (error) throw new Error(`snapshotDailyUsage upsert failed: ${error.message}`)

  return { schoolsProcessed: rows.length }
}

// Aggregate one school's daily usage over [periodStart, periodEnd] into a single
// billing-period row. Sets amount_due / student_days and leaves the row 'open' —
// amount_paid and status transitions belong to the collection track.
export async function rollUpPeriod(schoolId: string, periodStart: string, periodEnd: string): Promise<void> {
  const supabase = createServiceRoleClient()

  const { data: usage, error: readErr } = await supabase
    .from('platform_daily_usage')
    .select('accrued_amount, active_student_count')
    .eq('school_id', schoolId)
    .gte('usage_date', periodStart)
    .lte('usage_date', periodEnd)

  if (readErr) throw new Error(`rollUpPeriod read failed: ${readErr.message}`)

  // amount_due = Σ accrued (already 0 on free days).
  // student_days = Σ active_student_count over the period. NOTE: the schema
  // comment describes this as "Σ over billable days"; per the build spec we sum
  // every snapshotted day's count here. Flip the filter below if the
  // billable-only semantic is preferred later.
  let amountDue = 0
  let studentDays = 0
  ;(usage || []).forEach(u => {
    amountDue += Number(u.accrued_amount || 0)
    studentDays += Number(u.active_student_count || 0)
  })
  amountDue = round2(amountDue)

  const { error: upsertErr } = await supabase.from('platform_billing_periods').upsert(
    {
      school_id: schoolId,
      period_start: periodStart,
      period_end: periodEnd,
      student_days: studentDays,
      amount_due: amountDue,
      status: 'open',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'school_id,period_start' }
  )

  if (upsertErr) throw new Error(`rollUpPeriod upsert failed: ${upsertErr.message}`)
}

export interface SchoolBillingOverviewRow {
  schoolId: string
  schoolName: string
  activeStudentCount: number
  pricePerStudentMonth: number
  // true once onboarding_at is set and the daily accrual cron is running for
  // this school; false means the school hasn't started billing yet.
  onAccrualPath: boolean
  monthToDateAccrued: number
  billingStatus: string
}

// Cross-school billing overview for the /billing dashboard page. Batches the
// same per-school figures AccrualPanel shows for one school, across every
// school, in a fixed number of queries (no N+1).
export async function getAllSchoolsBillingOverview(): Promise<SchoolBillingOverviewRow[]> {
  const supabase = createServiceRoleClient()
  const today = new Date()
  const monthStart = formatDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)))
  const monthEnd = formatDate(today)

  const [{ data: schools }, { data: billingRows }, { data: students }, { data: usageRows }] = await Promise.all([
    supabase.from('schools').select('id, name'),
    supabase.from('platform_billing').select('school_id, billing_status, price_per_student_month, onboarding_at'),
    supabase.from('students').select('school_id').eq('status', 'active'),
    supabase
      .from('platform_daily_usage')
      .select('school_id, accrued_amount')
      .gte('usage_date', monthStart)
      .lte('usage_date', monthEnd),
  ])

  const billingBySchool = new Map((billingRows || []).map(b => [b.school_id, b]))

  const activeBySchool = new Map<string, number>()
  ;(students || []).forEach(s => {
    activeBySchool.set(s.school_id, (activeBySchool.get(s.school_id) || 0) + 1)
  })

  const mtdBySchool = new Map<string, number>()
  ;(usageRows || []).forEach(u => {
    mtdBySchool.set(u.school_id, (mtdBySchool.get(u.school_id) || 0) + Number(u.accrued_amount || 0))
  })

  return (schools || [])
    .map(s => {
      const b = billingBySchool.get(s.id)
      return {
        schoolId: s.id,
        schoolName: s.name,
        activeStudentCount: activeBySchool.get(s.id) || 0,
        pricePerStudentMonth: Number(b?.price_per_student_month ?? 500),
        onAccrualPath: !!b?.onboarding_at,
        monthToDateAccrued: round2(mtdBySchool.get(s.id) || 0),
        billingStatus: b?.billing_status || 'active',
      }
    })
    .sort((a, b) => a.schoolName.localeCompare(b.schoolName))
}

export interface BillingOverviewPage {
  rows: SchoolBillingOverviewRow[]
  total: number
}

// Paginated/filtered variant for the /billing page's per-school table
// (2026-10-10 rebuild). Deliberately still computes the join in memory rather
// than a true SQL-level paginated query: `schools`/`platform_billing` are
// bounded by TENANT count, not row count (hundreds of schools, not millions
// of payment rows) — the same reasoning businessQueries.ts already documents
// for its own aggregates. Filtering/sorting/paging happens after the join so
// "active students this month" etc. stay correct regardless of page size.
export async function getBillingOverviewPage(opts: {
  page?: number
  perPage?: number
  statusFilter?: string
  q?: string
}): Promise<BillingOverviewPage> {
  const all = await getAllSchoolsBillingOverview()
  const q = (opts.q || '').trim().toLowerCase()
  const filtered = all.filter(r =>
    (!opts.statusFilter || opts.statusFilter === 'all' || r.billingStatus === opts.statusFilter) &&
    (!q || r.schoolName.toLowerCase().includes(q))
  )
  const perPage = opts.perPage || 20
  const page = Math.max(1, opts.page || 1)
  const start = (page - 1) * perPage
  return { rows: filtered.slice(start, start + perPage), total: filtered.length }
}

export interface CurrentBillingSummary {
  // Is the school actually billing yet? (onboarding_at set)
  billingActive: boolean
  onboardingAt: string | null
  pricePerStudentMonth: number
  // Cycle phase for today
  phase: 'free' | 'billed'
  dayIndex: number
  phaseDay: number
  daysElapsedInPhase: number
  daysRemainingInPhase: number
  // Today's figures
  activeStudentsToday: number
  dailyAccrualToday: number
  // This calendar month so far
  monthToDateAccrued: number
  // The current month's rolled-up period row, if one exists yet
  period: {
    periodStart: string
    periodEnd: string
    studentDays: number
    amountDue: number
    amountPaid: number
    status: string
  } | null
}

// Read-only summary for the dashboard's AccrualPanel. Design default: the
// "current period" is the calendar month (period_start = 1st, period_end = last
// day of month). Month-to-date accrual is summed from platform_daily_usage.
export async function getCurrentBillingSummary(schoolId: string): Promise<CurrentBillingSummary> {
  const supabase = createServiceRoleClient()
  const today = new Date()

  const [{ data: billing }, { count: activeCount }] = await Promise.all([
    supabase
      .from('platform_billing')
      .select('onboarding_at, price_per_student_month')
      .eq('school_id', schoolId)
      .maybeSingle(),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('status', 'active'),
  ])

  const pricePerStudentMonth = Number(billing?.price_per_student_month ?? 500)
  const activeStudentsToday = activeCount || 0

  // Not billing yet — return a null-ish, read-only shape the panel can render.
  if (!billing?.onboarding_at) {
    return {
      billingActive: false,
      onboardingAt: null,
      pricePerStudentMonth,
      phase: 'free',
      dayIndex: 0,
      phaseDay: 0,
      daysElapsedInPhase: 0,
      daysRemainingInPhase: 0,
      activeStudentsToday,
      dailyAccrualToday: 0,
      monthToDateAccrued: 0,
      period: null,
    }
  }

  const cycle = cycleBillable(billing.onboarding_at as string, today)
  const phase: 'free' | 'billed' = cycle.billable ? 'billed' : 'free'
  const daysElapsedInPhase = cycle.billable ? cycle.phaseDay - FREE_DAYS : cycle.phaseDay
  const dailyAccrualToday = cycle.billable
    ? round2(activeStudentsToday * (pricePerStudentMonth / DAYS_IN_MONTH_FOR_PRORATA))
    : 0

  // Calendar-month boundaries (design default), in UTC to match usage_date.
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))
  const periodStart = formatDate(monthStart)
  const periodEnd = formatDate(monthEnd)

  const [{ data: mtdRows }, { data: periodRow }] = await Promise.all([
    supabase
      .from('platform_daily_usage')
      .select('accrued_amount')
      .eq('school_id', schoolId)
      .gte('usage_date', periodStart)
      .lte('usage_date', formatDate(today)),
    supabase
      .from('platform_billing_periods')
      .select('period_start, period_end, student_days, amount_due, amount_paid, status')
      .eq('school_id', schoolId)
      .eq('period_start', periodStart)
      .maybeSingle(),
  ])

  const monthToDateAccrued = round2(
    (mtdRows || []).reduce((sum, r) => sum + Number(r.accrued_amount || 0), 0)
  )

  return {
    billingActive: true,
    onboardingAt: billing.onboarding_at as string,
    pricePerStudentMonth,
    phase,
    dayIndex: cycle.dayIndex,
    phaseDay: cycle.phaseDay,
    daysElapsedInPhase,
    daysRemainingInPhase: cycle.daysUntilPhaseChange,
    activeStudentsToday,
    dailyAccrualToday,
    monthToDateAccrued,
    period: periodRow
      ? {
          periodStart: periodRow.period_start,
          periodEnd: periodRow.period_end,
          studentDays: Number(periodRow.student_days || 0),
          amountDue: Number(periodRow.amount_due || 0),
          amountPaid: Number(periodRow.amount_paid || 0),
          status: periodRow.status,
        }
      : null,
  }
}
