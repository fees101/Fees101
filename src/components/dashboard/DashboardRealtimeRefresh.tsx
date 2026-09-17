'use client'

// Minimal client wrapper — the dashboard page itself is a pure server
// component with no existing client child suitable for the hook, so this
// renders nothing and only keeps the realtime subscription alive.
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'

export default function DashboardRealtimeRefresh({ schoolId }: { schoolId: string }) {
  useRealtimeRefresh([
    { table: 'invoices', filter: `school_id=eq.${schoolId}` },
    { table: 'payments', filter: `school_id=eq.${schoolId}` },
  ])
  return null
}
