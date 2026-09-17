'use client'

// Minimal client wrapper — the discounts page renders two independent list
// client components (DiscountRequestsList, ActiveRecurringDiscountsList) and
// has no shared Layout wrapping the whole page, so this renders nothing and
// only keeps the subscription alive. Trigger here is usually a second admin
// approving/rejecting, not a webhook, but it's the same staleness/race
// problem as everywhere else.
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'

export default function DiscountsRealtimeRefresh({ schoolId }: { schoolId: string }) {
  useRealtimeRefresh([{ table: 'discounts', filter: `school_id=eq.${schoolId}` }])
  return null
}
