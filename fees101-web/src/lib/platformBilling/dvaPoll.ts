// Backstop for processPlatformPaystackWebhook's DVA-transfer branch. Paystack
// retries a failed webhook delivery, but if it never reaches us at all (DNS
// blip, deploy mid-delivery, dashboard misconfigured), a school that actually
// paid stays stuck suspended with no other signal telling us to check again.
// This polls Paystack directly for any school that both has a platform DVA and
// isn't currently 'active', so a missed webhook self-heals on the next cron run
// instead of requiring a human to notice.
//
// Only looks at schools that are already off the happy path (payment_due /
// grace / suspended) — an active school has nothing to reconcile, and polling
// every school on every run would be a lot of needless Paystack calls.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { listCustomerTransactions } from './paystack'
import { reconcilePlatformDvaCharge } from './reconcile'

export type DvaPollOutcome =
  | { schoolId: string; status: 'reconciled'; reference: string; amount: number }
  | { schoolId: string; status: 'nothing_found' }
  | { schoolId: string; status: 'error'; error: string }

export async function pollPlatformDvaTransfers(): Promise<DvaPollOutcome[]> {
  const svc = createServiceRoleClient()

  const { data: schools } = await svc
    .from('platform_billing')
    .select('school_id, platform_dva_reference')
    .not('platform_dva_reference', 'is', null)
    .in('billing_status', ['payment_due', 'grace', 'suspended'])

  const outcomes: DvaPollOutcome[] = []

  for (const row of schools || []) {
    const schoolId = row.school_id as string
    try {
      const transactions = await listCustomerTransactions(row.platform_dva_reference as string)
      if (transactions.length === 0) {
        outcomes.push({ schoolId, status: 'nothing_found' })
        continue
      }

      // Reconcile every successful transaction we haven't recorded yet —
      // reconcilePlatformDvaCharge is idempotent per reference, so replaying
      // one we've already applied (e.g. via the webhook) is a safe no-op.
      let lastApplied: { reference: string; amount: number } | null = null
      for (const tx of transactions) {
        const result = await reconcilePlatformDvaCharge(svc, {
          schoolId,
          reference: tx.reference,
          amountNaira: tx.amountNaira,
          paidAt: tx.paidAt,
        })
        if (result === 'applied') lastApplied = { reference: tx.reference, amount: tx.amountNaira }
      }

      outcomes.push(
        lastApplied
          ? { schoolId, status: 'reconciled', reference: lastApplied.reference, amount: lastApplied.amount }
          : { schoolId, status: 'nothing_found' },
      )
    } catch (err) {
      outcomes.push({ schoolId, status: 'error', error: err instanceof Error ? err.message : 'poll failed' })
    }
  }

  return outcomes
}
