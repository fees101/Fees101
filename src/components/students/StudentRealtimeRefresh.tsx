'use client'

// Minimal client wrapper — the student detail page is a server component
// with several independent client children (GenerateInvoiceButton,
// StudentActivityTimeline, tabs, ...) and no single Layout component that
// wraps the whole page, so this exists only to keep the subscription alive.
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'

export default function StudentRealtimeRefresh({ studentId }: { studentId: string }) {
  useRealtimeRefresh([
    { table: 'invoices', filter: `student_id=eq.${studentId}` },
    { table: 'payments', filter: `student_id=eq.${studentId}` },
  ])
  return null
}
