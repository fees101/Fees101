'use client'

// Reusable "server-rendered page, live-refreshed" hook: subscribes to
// postgres_changes on one or more tables (each pre-filtered by school_id/
// invoice_id/student_id as the caller sees fit) and calls router.refresh()
// when a change lands. Debounced so a burst (e.g. a 400-invoice generation
// job) coalesces into one refresh, not hundreds.
//
// Auto-refreshes mid-read by design (owner call, 2026-09-24) — figures
// update live under the viewer's cursor rather than waiting for a manual
// "load changes" click.
//
// One channel per subscription entry, all on the same websocket connection
// createClient() already reuses per browser tab — this adds no page-load
// latency and no new connection per page.

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const COALESCE_DEBOUNCE_MS = 450

export interface RealtimeSubscription {
  table: string
  // Postgres realtime filter syntax, e.g. `school_id=eq.${schoolId}` or
  // `invoice_id=eq.${invoiceId}`. Omit to receive all rows on the table
  // (RLS still applies, so this never leaks cross-tenant rows).
  filter?: string
}

export function useRealtimeRefresh(subscriptions: RealtimeSubscription[]) {
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Subscriptions are built fresh on every render from page params (schoolId,
  // invoiceId, ...); comparing serialized content instead of the array
  // reference is what actually lets the effect below settle after mount.
  const key = JSON.stringify(subscriptions)

  useEffect(() => {
    if (subscriptions.length === 0) return

    const supabase = createClient()
    const channels = subscriptions.map(({ table, filter }, i) =>
      supabase
        .channel(`realtime-refresh:${table}:${i}:${key}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          () => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
            debounceRef.current = setTimeout(() => {
              debounceRef.current = null
              router.refresh()
            }, COALESCE_DEBOUNCE_MS)
          }
        )
        .subscribe()
    )

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      for (const channel of channels) supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
