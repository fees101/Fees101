'use client'

// Reusable "keep this server-rendered page live" wrapper. Renders nothing;
// it exists only to hold a realtime subscription open for pages that have no
// single client Layout component to hang the hook on. The server page builds
// the school-/id-scoped subscriptions and passes them in, so one component
// covers every page instead of a bespoke *RealtimeRefresh per route.
//
// (DashboardRealtimeRefresh / StudentRealtimeRefresh / DiscountsRealtimeRefresh
// predate this and stay as-is; new pages use this generic wrapper.)
import { useRealtimeRefresh, type RealtimeSubscription } from '@/lib/realtime/useRealtimeRefresh'

export default function RealtimeRefresh({ subscriptions }: { subscriptions: RealtimeSubscription[] }) {
  useRealtimeRefresh(subscriptions)
  return null
}
