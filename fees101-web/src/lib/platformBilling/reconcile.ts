// Reconciliation helpers shared by the recurring-debit path and the platform
// webhook, so "a charge settled / failed -> update the period and billing status"
// lives in exactly one place regardless of which path observes the result:
//   - in test mode chargeMandate returns 'success' synchronously, so the debit
//     code reconciles inline;
//   - in production it returns 'processing' and the real result arrives as a
//     charge.success / charge.failed webhook, which reconciles instead.
// Both call through here. The webhook already guards on "only transition
// pending -> success once", so a period is never double-credited.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { round2 } from './accrualPeriod'
import { setupFeeNaira } from './config'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

// Postgres unique_violation. M1 adds a unique index on
// platform_billing_charges(paystack_reference); if a read-then-insert races (two
// observers of the same transfer), the loser hits this and we treat it as
// "already recorded", not an error.
const UNIQUE_VIOLATION = '23505'

// Insert a charge row, tolerating the unique-violation that the M1 index raises
// on a duplicate reference. A duplicate means another path already recorded this
// transfer, so it is success, not failure.
async function insertChargeIdempotent(
  svc: ServiceClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await svc.from('platform_billing_charges').insert(row)
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`Failed to record charge: ${error.message}`)
  }
}

// First day (UTC) of the month after `now` — the next bill's due date, set when
// a payment clears so the dunning ladder sees the school as current.
function firstOfNextMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
}

// A direct-debit charge cleared. Credit the period it paid (marking it paid or
// partial) and move the school's billing forward: status active, record the
// charge, set the next due date. Idempotent at the caller (gated on the charge
// row transitioning into success), so it runs once per settled charge.
export async function applySuccessfulCharge(
  svc: ServiceClient,
  p: { schoolId: string; reference: string; amountNaira: number; paidAt: string | null; periodId: string | null },
): Promise<void> {
  const now = new Date()

  if (p.periodId) {
    const { data: period } = await svc
      .from('platform_billing_periods')
      .select('amount_due, amount_paid')
      .eq('id', p.periodId)
      .maybeSingle()
    if (period) {
      const newPaid = round2(Number(period.amount_paid || 0) + p.amountNaira)
      // tiny epsilon so floating-point equality doesn't leave a fully-paid
      // period stuck at 'partial'.
      const fullyPaid = newPaid + 0.0001 >= Number(period.amount_due || 0)
      await svc
        .from('platform_billing_periods')
        .update({
          amount_paid: newPaid,
          status: fullyPaid ? 'paid' : 'partial',
          updated_at: now.toISOString(),
        })
        .eq('id', p.periodId)
    }
  }

  await svc
    .from('platform_billing')
    .update({
      billing_status: 'active',
      billing_status_changed_at: now.toISOString(),
      last_charged_at: p.paidAt || now.toISOString(),
      last_charge_amount: p.amountNaira,
      last_charge_reference: p.reference,
      next_charge_due_at: firstOfNextMonth(now),
      updated_at: now.toISOString(),
    })
    .eq('school_id', p.schoolId)
}

// A payment landed in a school's platform DVA (bank transfer, not a mandate
// debit) — via the webhook's customer_code match, or the polling backstop
// re-checking Paystack directly. Idempotent on paystack_reference, so the
// webhook and the poller can both observe the same transaction safely.
export async function reconcilePlatformDvaCharge(
  svc: ServiceClient,
  p: { schoolId: string; reference: string; amountNaira: number; paidAt: string | null },
): Promise<'applied' | 'already_applied'> {
  const { data: existing } = await svc
    .from('platform_billing_charges')
    .select('id, status')
    .eq('paystack_reference', p.reference)
    .maybeSingle()
  if (existing?.status === 'success') return 'already_applied'

  // C2 — setup transfer that opens the gate. A DVA school whose owner chose the
  // "pay by bank transfer instead" fallback never completes a mandate checkout,
  // so the FIRST transfer (of at least the setup fee) is what unlocks the app,
  // the same way a successful mandate checkout does on the card/bank rail. This
  // mirrors the console's reconcilePlatformTransfer "not connected" branch, but
  // in the LIVE web webhook path so a hands-off self-onboarding school never
  // waits on a Fees101 staffer. Idempotent: keyed on billing_connected_at being
  // null, so a second transfer falls through to the normal period-crediting path.
  const { data: billing } = await svc
    .from('platform_billing')
    .select('billing_connected_at, setup_fee_amount, onboarding_at')
    .eq('school_id', p.schoolId)
    .maybeSingle()

  if (billing && !billing.billing_connected_at) {
    const required = Number(billing.setup_fee_amount) || setupFeeNaira()
    const nowIso = new Date().toISOString()
    const paidAt = p.paidAt || nowIso

    // Record the inbound transfer (idempotently) as the setup fee.
    if (existing) {
      await svc
        .from('platform_billing_charges')
        .update({ status: 'success', paid_at: paidAt, charged_by: 'setup_fee' })
        .eq('id', existing.id)
    } else {
      await insertChargeIdempotent(svc, {
        school_id: p.schoolId,
        amount: p.amountNaira,
        status: 'success',
        paystack_reference: p.reference,
        method: 'dva_transfer',
        charged_by: 'setup_fee',
        paid_at: paidAt,
      })
    }

    // Short of the setup fee: the transfer is recorded so it isn't lost, but the
    // gate stays shut and the owner still needs to send the rest.
    if (p.amountNaira < required) return 'applied'

    await svc
      .from('platform_billing')
      .update({
        setup_fee_status: 'paid',
        setup_fee_paid_at: nowIso,
        billing_method: 'dva',
        billing_connected_at: nowIso, // the entry-gate flag
        onboarding_at: billing.onboarding_at || nowIso, // free-period day 0
        billing_status: 'active',
        billing_status_changed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('school_id', p.schoolId)

    return 'applied'
  }

  // Already connected — a normal recurring-bill transfer. Credit the oldest open
  // period, if any.
  const { data: openPeriod } = await svc
    .from('platform_billing_periods')
    .select('id')
    .eq('school_id', p.schoolId)
    .neq('status', 'paid')
    .order('period_start', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    await svc
      .from('platform_billing_charges')
      .update({ status: 'success', paid_at: p.paidAt })
      .eq('id', existing.id)
  } else {
    await insertChargeIdempotent(svc, {
      school_id: p.schoolId,
      amount: p.amountNaira,
      status: 'success',
      paystack_reference: p.reference,
      method: 'dva_transfer',
      paid_at: p.paidAt,
      charged_by: 'monthly_fee',
    })
  }

  await applySuccessfulCharge(svc, {
    schoolId: p.schoolId,
    reference: p.reference,
    amountNaira: p.amountNaira,
    paidAt: p.paidAt,
    periodId: openPeriod?.id ?? null,
  })

  return 'applied'
}

// A direct-debit charge failed. Nudge the school into the dunning ladder's first
// rung (payment_due) if it was current; if it's already further down the ladder
// (grace/suspended), leave it — the ladder, keyed on how overdue it is, owns the
// escalation from here. Never touches a cancelled account.
//
// `now` must be the SAME instant the caller's ladder evaluation will use (the
// cron passes one `now` through both). Stamping next_charge_due_at with a
// fresh `new Date()` here would land a few ms after that `now`, so the ladder's
// very next pass (same cron run) computes a negative "days overdue" and flips
// the school straight back to active — the failure, correctly recorded for an
// instant, is invisible by the time the cron response is read.
export async function applyFailedCharge(svc: ServiceClient, schoolId: string, now: Date = new Date()): Promise<void> {
  const { data: billing } = await svc
    .from('platform_billing')
    .select('billing_status, next_charge_due_at')
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!billing || billing.billing_status !== 'active') return

  const nowIso = now.toISOString()
  // Seed next_charge_due_at on the active -> payment_due transition if it's unset
  // (a school whose very first debit fails never had a due date), so the ladder
  // has a clock to count overdue days from. Later failures hit the guard above
  // and leave this date alone, so the overdue clock doesn't reset each retry.
  await svc
    .from('platform_billing')
    .update({
      billing_status: 'payment_due',
      billing_status_changed_at: nowIso,
      ...(billing.next_charge_due_at ? {} : { next_charge_due_at: nowIso }),
    })
    .eq('school_id', schoolId)
}
