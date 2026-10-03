// Periodic in-app nudge for schools still paying their platform fee by bank
// transfer (DVA) to switch to automatic debit instead. Distinct from the
// dunning ladder's payment-due/overdue reminders in dunning.ts and
// dvaReminders.ts/mandateReminders.ts — those fire on a missed payment; this
// one fires on a fixed cadence regardless of payment status, since a DVA
// school can be paying on time every month and still have no automatic
// fallback in place if they ever miss a transfer.
//
// Reuses the existing admin_notifications bell/dropdown — no new UI.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

const REMIND_EVERY_DAYS = 14

export async function remindDvaSchoolsToSwitch(now: Date = new Date()): Promise<string[]> {
  const svc = createServiceRoleClient()
  const { data: schools } = await svc
    .from('platform_billing')
    .select('school_id, dva_switch_reminded_at')
    .eq('billing_method', 'dva')
    .not('billing_connected_at', 'is', null)

  const reminded: string[] = []
  for (const row of schools || []) {
    const lastReminded = row.dva_switch_reminded_at ? new Date(row.dva_switch_reminded_at) : null
    const daysSince = lastReminded ? (now.getTime() - lastReminded.getTime()) / 86_400_000 : Infinity
    if (daysSince < REMIND_EVERY_DAYS) continue

    await svc.from('admin_notifications').insert({
      school_id: row.school_id,
      type: 'dva_switch_nudge',
      title: 'Switch to automatic bank debit',
      body: 'You’re currently paying your platform fee by bank transfer. Connect automatic bank debit so you never risk missing a payment while relying on manual transfers.',
    })

    await svc
      .from('platform_billing')
      .update({ dva_switch_reminded_at: now.toISOString() })
      .eq('school_id', row.school_id)

    reminded.push(row.school_id)
  }
  return reminded
}
