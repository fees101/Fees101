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

type ServiceClient = ReturnType<typeof createServiceRoleClient>

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
