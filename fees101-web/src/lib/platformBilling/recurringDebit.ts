// Recurring direct-debit (slice 2, step 4 of the billing build sequence). Once a
// school is past its 65 free days, this charges the usage-accrued amount for the
// completed month against the mandate established at connect-billing time.
//
// Design:
//   - We bill the PREVIOUS completed calendar month (usage-accrued: the pro-rata
//     ₦500/student/day summed over that month, from platform_daily_usage via the
//     accrual engine). A month still inside the free window accrues 0, so there
//     is simply nothing to charge.
//   - Idempotent per period: once a pending or successful charge exists for a
//     period we never charge it again. A period whose only charges FAILED is
//     retried on the next run (a simple daily retry; the dunning ladder escalates
//     by elapsed time, so this doesn't retry forever without consequence).
//   - Direct debit settles asynchronously: chargeMandate returns 'processing',
//     and the real result lands as a webhook. In test mode it returns 'success'
//     synchronously, which we reconcile inline. Either way reconcile.ts is the
//     single place that credits the period and advances billing.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { chargeMandate, verifyAuthorizationStatus } from './paystack'
import { previousMonthBounds, rollUpPeriod, round2 } from './accrualPeriod'
import { applyFailedCharge, applySuccessfulCharge } from './reconcile'
import { cycleBillable } from './cycle'

export type DebitOutcome =
  | { schoolId: string; status: 'charged'; amount: number; reference: string; settlement: 'success' | 'processing' }
  | { schoolId: string; status: 'skipped'; reason: string }
  | { schoolId: string; status: 'error'; error: string }

// Attempt the monthly debit for one school. Pure per-school unit so it can be
// run from the cron, or ad hoc for a single school from the dashboard later.
export async function chargeSchoolMonthly(schoolId: string, now: Date = new Date()): Promise<DebitOutcome> {
  const svc = createServiceRoleClient()

  const { data: billing } = await svc
    .from('platform_billing')
    .select(
      'onboarding_at, billing_connected_at, mandate_authorization_code, mandate_email, mandate_status, setup_fee_reference',
    )
    .eq('school_id', schoolId)
    .maybeSingle()

  if (!billing) return { schoolId, status: 'skipped', reason: 'no_billing_row' }
  if (!billing.billing_connected_at) return { schoolId, status: 'skipped', reason: 'not_connected' }
  if (!billing.onboarding_at) return { schoolId, status: 'skipped', reason: 'no_onboarding_anchor' }
  if (!billing.mandate_authorization_code || !billing.mandate_email) {
    return { schoolId, status: 'skipped', reason: 'no_mandate' }
  }

  // Roll up the completed month and work out what's still owed.
  const { periodStart, periodEnd } = previousMonthBounds(now)
  const { periodId, amountDue, amountPaid } = await rollUpPeriod(schoolId, periodStart, periodEnd)
  const outstanding = round2(amountDue - amountPaid)
  if (outstanding <= 0) return { schoolId, status: 'skipped', reason: 'nothing_due' }

  // Idempotency: don't charge a period that already has a pending/successful
  // charge. Only all-failed periods fall through to a retry.
  if (periodId) {
    const { data: priorCharges } = await svc
      .from('platform_billing_charges')
      .select('id, status')
      .eq('period_id', periodId)
    if ((priorCharges || []).some(c => c.status === 'pending' || c.status === 'success')) {
      return { schoolId, status: 'skipped', reason: 'already_charged' }
    }
  }

  // The mandate must be chargeable. By debit time (65+ days out) the
  // direct_debit.authorization.active webhook has normally flipped it already;
  // if it still reads pending, verify lazily before giving up.
  let mandateStatus = billing.mandate_status
  if (mandateStatus !== 'active') {
    if (billing.setup_fee_reference) {
      try {
        const auth = await verifyAuthorizationStatus(billing.setup_fee_reference)
        if (auth.active) {
          mandateStatus = 'active'
          await svc
            .from('platform_billing')
            .update({ mandate_status: 'active', mandate_active_at: new Date().toISOString() })
            .eq('school_id', schoolId)
        }
      } catch {
        // fall through to the skip below; a transient verify error shouldn't
        // crash the whole cron run.
      }
    }
    if (mandateStatus !== 'active') return { schoolId, status: 'skipped', reason: 'mandate_not_active' }
  }

  // Record the attempt first (pending), so the webhook has a row + period_id to
  // reconcile against and we never charge without a trace.
  const reference = `due_${schoolId}_${Date.now()}`
  const { data: chargeRow } = await svc
    .from('platform_billing_charges')
    .insert({
      school_id: schoolId,
      amount: outstanding,
      status: 'pending',
      paystack_reference: reference,
      method: 'direct_debit',
      charged_by: 'monthly_fee',
      period_id: periodId,
    })
    .select('id')
    .single()

  try {
    const result = await chargeMandate({
      authorizationCode: billing.mandate_authorization_code,
      email: billing.mandate_email,
      amountNaira: outstanding,
      reference,
    })

    // Direct debit normally returns 'processing' (webhook finalises). Test mode
    // returns 'success', which we settle inline here.
    if (result.status === 'success') {
      await svc
        .from('platform_billing_charges')
        .update({ status: 'success', paid_at: new Date().toISOString() })
        .eq('id', chargeRow!.id)
      await applySuccessfulCharge(svc, {
        schoolId,
        reference,
        amountNaira: outstanding,
        paidAt: new Date().toISOString(),
        periodId,
      })
      return { schoolId, status: 'charged', amount: outstanding, reference, settlement: 'success' }
    }

    // 'processing' (or any non-failed status): leave the charge pending for the
    // webhook, but record what we attempted on the billing row.
    await svc
      .from('platform_billing')
      .update({ last_charge_amount: outstanding, last_charge_reference: reference, updated_at: new Date().toISOString() })
      .eq('school_id', schoolId)
    return { schoolId, status: 'charged', amount: outstanding, reference, settlement: 'processing' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'charge failed'
    await svc
      .from('platform_billing_charges')
      .update({ status: 'failed', failure_reason: message })
      .eq('id', chargeRow!.id)
    await applyFailedCharge(svc, schoolId, now)
    return { schoolId, status: 'error', error: message }
  }
}

// Run the monthly debit for every school whose free period has ended and who has
// a mandate on file. Safe to run daily: chargeSchoolMonthly is idempotent per
// period. `cycleBillable` gates out schools still inside their free window so we
// don't even look them up.
export async function runMonthlyDebits(now: Date = new Date()): Promise<DebitOutcome[]> {
  const svc = createServiceRoleClient()
  const { data: schools } = await svc
    .from('platform_billing')
    .select('school_id, onboarding_at')
    .not('billing_connected_at', 'is', null)
    .not('mandate_authorization_code', 'is', null)

  const outcomes: DebitOutcome[] = []
  for (const row of schools || []) {
    // Still in the free window for the month we'd bill? Nothing accrued, skip the
    // round-trip. (We bill the previous month, so test billability at month end.)
    const { periodEnd } = previousMonthBounds(now)
    const { billable } = cycleBillable(row.onboarding_at as string, new Date(periodEnd))
    if (!billable) {
      outcomes.push({ schoolId: row.school_id, status: 'skipped', reason: 'free_period' })
      continue
    }
    outcomes.push(await chargeSchoolMonthly(row.school_id, now))
  }
  return outcomes
}
