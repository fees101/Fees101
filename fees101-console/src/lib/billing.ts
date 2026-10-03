import { createServiceRoleClient } from './supabase/serviceRole'

// Suspension ladder day-counts — the exact numbers are a business call, not
// a technical one (flagged in ROADMAP research as "only the owner can make
// this call"). These are placeholder defaults so the mechanism is complete
// and testable now; change them here once you've decided, no schema change
// needed.
const GRACE_PERIOD_DAYS = 7 // active -> payment_due -> (this many days) -> grace
const SUSPEND_AFTER_GRACE_DAYS = 7 // grace -> (this many more days) -> suspended

// Walks a school's billing_status forward based on how overdue
// next_charge_due_at is. Called from the cron-checkable API route (see
// src/app/api/cron/evaluate-billing/route.ts), or can be invoked ad hoc per
// school from the dashboard. Only ever moves the ladder based on elapsed
// time — never charges anything itself.
export async function evaluateSuspensionLadder(schoolId: string): Promise<{ from: string; to: string } | null> {
  const supabase = createServiceRoleClient()
  const { data: billing } = await supabase
    .from('platform_billing')
    .select('billing_status, next_charge_due_at, billing_status_changed_at')
    .eq('school_id', schoolId)
    .maybeSingle()

  if (!billing || !billing.next_charge_due_at) return null
  if (billing.billing_status === 'cancelled') return null

  const now = Date.now()
  const dueAt = new Date(billing.next_charge_due_at).getTime()
  const daysOverdue = (now - dueAt) / (1000 * 60 * 60 * 24)

  let nextStatus = billing.billing_status
  if (daysOverdue <= 0) nextStatus = 'active'
  else if (daysOverdue <= GRACE_PERIOD_DAYS) nextStatus = 'payment_due'
  else if (daysOverdue <= GRACE_PERIOD_DAYS + SUSPEND_AFTER_GRACE_DAYS) nextStatus = 'grace'
  else nextStatus = 'suspended'

  if (nextStatus === billing.billing_status) return null

  await supabase
    .from('platform_billing')
    .update({ billing_status: nextStatus, billing_status_changed_at: new Date().toISOString() })
    .eq('school_id', schoolId)

  await supabase.from('platform_audit_log').insert({
    actor_name: 'System',
    action: 'billing.status_changed',
    school_id: schoolId,
    summary: `Billing status moved from ${billing.billing_status} to ${nextStatus} (${Math.floor(daysOverdue)} days overdue)`,
    metadata: { from: billing.billing_status, to: nextStatus, daysOverdue: Math.floor(daysOverdue) },
  })

  return { from: billing.billing_status, to: nextStatus }
}
