// Period roll-up for the recurring direct-debit (slice 2). The daily accrual
// snapshots (platform_daily_usage) are produced by the accrual engine in the
// console app; this is the web-side consumer that aggregates a completed month
// into a single platform_billing_periods row we can then debit.
//
// This mirrors the rollUpPeriod logic in fees101-console/src/lib/accrual.ts, on
// purpose: the money-moving debit path lives with the mandate (in web, the
// deployed app), so it must not depend on importing console code. If the accrual
// formula changes, change it in both places.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// kobo-safe naira rounding (same as the accrual engine's round2).
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function formatDate(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10)
}

// Calendar-month bounds for the month BEFORE `now` (UTC), the period a debit
// run settles. e.g. run on 2026-12-01 -> November's [2026-11-01, 2026-11-30].
export function previousMonthBounds(now: Date): { periodStart: string; periodEnd: string } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 0)) // day 0 of this month = last day of previous
  return { periodStart: formatDate(start), periodEnd: formatDate(end) }
}

export type PeriodRollup = {
  periodId: string | null
  amountDue: number
  amountPaid: number
  status: string
}

// Aggregate one school's daily usage over [periodStart, periodEnd] into its
// platform_billing_periods row. Recomputes amount_due / student_days from the
// snapshots every time (so a late snapshot is picked up) but never touches
// amount_paid or a terminal status — those belong to the collection track, so a
// re-run won't un-pay a period. Returns the current state for the debit to act on.
export async function rollUpPeriod(
  schoolId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodRollup> {
  const svc = createServiceRoleClient()

  const { data: usage } = await svc
    .from('platform_daily_usage')
    .select('accrued_amount, active_student_count')
    .eq('school_id', schoolId)
    .gte('usage_date', periodStart)
    .lte('usage_date', periodEnd)

  let amountDue = 0
  let studentDays = 0
  ;(usage || []).forEach(u => {
    amountDue += Number(u.accrued_amount || 0)
    studentDays += Number(u.active_student_count || 0)
  })
  amountDue = round2(amountDue)

  const { data: existing } = await svc
    .from('platform_billing_periods')
    .select('id, amount_paid, status')
    .eq('school_id', schoolId)
    .eq('period_start', periodStart)
    .maybeSingle()

  if (existing) {
    await svc
      .from('platform_billing_periods')
      .update({ amount_due: amountDue, student_days: studentDays, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return {
      periodId: existing.id,
      amountDue,
      amountPaid: Number(existing.amount_paid || 0),
      status: existing.status,
    }
  }

  const { data: inserted } = await svc
    .from('platform_billing_periods')
    .insert({
      school_id: schoolId,
      period_start: periodStart,
      period_end: periodEnd,
      student_days: studentDays,
      amount_due: amountDue,
      status: 'open',
    })
    .select('id')
    .single()

  return { periodId: inserted?.id ?? null, amountDue, amountPaid: 0, status: 'open' }
}
