// Dunning / suspension ladder (slice 2, step 5). When a monthly debit fails the
// school isn't charged again immediately; instead its billing_status walks down
// a ladder by how overdue next_charge_due_at is:
//
//   active -> payment_due -> (grace after N days) -> suspended (after M more)
//
// A successful charge resets this (reconcile.ts sets status active and pushes
// next_charge_due_at forward), so a school that pays on retry climbs back out.
// This only MOVES the status; it never charges anything. Suspension does not yet
// hard-block app entry — that gate is a deliberate follow-up for the owner to
// sign off on. For now the status is recorded and visible.
//
// Mirrors fees101-console/src/lib/billing.ts evaluateSuspensionLadder, on the
// web side so it ships with the deployed debit path. Day-counts are a business
// call; these are the agreed placeholders, changeable here with no schema change.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

const GRACE_PERIOD_DAYS = 7 // payment_due -> (this many days overdue) -> grace
const SUSPEND_AFTER_GRACE_DAYS = 7 // grace -> (this many more) -> suspended

export async function evaluateSuspensionLadder(
  schoolId: string,
  now: Date = new Date(),
): Promise<{ from: string; to: string } | null> {
  const svc = createServiceRoleClient()
  const { data: billing } = await svc
    .from('platform_billing')
    .select('billing_status, next_charge_due_at')
    .eq('school_id', schoolId)
    .maybeSingle()

  if (!billing || !billing.next_charge_due_at) return null
  if (billing.billing_status === 'cancelled') return null

  const daysOverdue = (now.getTime() - new Date(billing.next_charge_due_at).getTime()) / 86_400_000

  let nextStatus = billing.billing_status
  // Strictly negative = genuinely not due yet. Exactly 0 (due this instant,
  // e.g. the same cron pass that just recorded a failure) already counts as
  // overdue — a payment that's due now and unpaid is not "current".
  if (daysOverdue < 0) nextStatus = 'active'
  else if (daysOverdue <= GRACE_PERIOD_DAYS) nextStatus = 'payment_due'
  else if (daysOverdue <= GRACE_PERIOD_DAYS + SUSPEND_AFTER_GRACE_DAYS) nextStatus = 'grace'
  else nextStatus = 'suspended'

  if (nextStatus === billing.billing_status) return null

  await svc
    .from('platform_billing')
    .update({ billing_status: nextStatus, billing_status_changed_at: now.toISOString() })
    .eq('school_id', schoolId)

  await svc.from('platform_audit_log').insert({
    actor_name: 'System',
    action: 'billing.status_changed',
    school_id: schoolId,
    summary: `Billing status moved from ${billing.billing_status} to ${nextStatus} (${Math.floor(daysOverdue)} days overdue)`,
    metadata: { from: billing.billing_status, to: nextStatus, daysOverdue: Math.floor(daysOverdue) },
  })

  return { from: billing.billing_status, to: nextStatus }
}

// Evaluate the ladder for every connected school. Cheap (one row read per
// school, a write only on an actual transition); safe to run daily from the cron.
export async function evaluateAllLadders(now: Date = new Date()): Promise<{ from: string; to: string; schoolId: string }[]> {
  const svc = createServiceRoleClient()
  const { data: schools } = await svc
    .from('platform_billing')
    .select('school_id')
    .not('billing_connected_at', 'is', null)

  const moves: { from: string; to: string; schoolId: string }[] = []
  for (const row of schools || []) {
    const move = await evaluateSuspensionLadder(row.school_id, now)
    if (move) moves.push({ ...move, schoolId: row.school_id })
  }
  return moves
}
