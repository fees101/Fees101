import { createClient } from '@/lib/supabase/server'
import { formatPaymentMethod } from '@/lib/paymentMethod'
import { formatDateTime } from '@/lib/format/date'

interface StudentActivityTimelineProps {
  studentId: string
  studentName: string
  parentName: string
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

// The single-surface "Activity" panel (App Shell showStudent, right column):
// a 2px ink top rule, an 18px/800 heading, then hairline-topped rows whose
// headline reads in ledger green only where money actually arrived and in ink
// otherwise. No pills, no icons, no tag chips — colour carries the meaning.
export default async function StudentActivityTimeline({
  studentId,
  studentName,
  parentName,
}: StudentActivityTimelineProps) {
  const supabase = await createClient()

  // Get recent payments for this student
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount, method, paid_at, provider_reference')
    .eq('student_id', studentId)
    .eq('match_status', 'matched')
    .order('paid_at', { ascending: false })
    .limit(4)

  // Get invoices for this student
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, total_amount, generated_at, sent_at, billing_cycles(name)')
    .eq('student_id', studentId)
    .order('generated_at', { ascending: false })
    .limit(4)

  type Event = {
    id: string
    type: 'payment' | 'invoice'
    description: string
    detail?: string
    timestamp: string
  }

  const events: Event[] = []

  payments?.forEach(payment => {
    events.push({
      id: `payment-${payment.id}`,
      type: 'payment',
      description: `${formatNaira(Number(payment.amount))} received from ${parentName}`,
      detail: payment.provider_reference ? `Receipt #${payment.provider_reference}` : formatPaymentMethod(payment.method),
      timestamp: payment.paid_at,
    })
  })

  invoices?.forEach(invoice => {
    events.push({
      id: `invoice-${invoice.id}`,
      type: 'invoice',
      description: invoice.sent_at ? `Invoice sent to ${parentName}` : 'Invoice generated',
      // @ts-expect-error - joined object
      detail: invoice.billing_cycles?.name || '',
      timestamp: invoice.generated_at,
    })
  })

  // Sort all events by timestamp descending, then limit to 7
  const sorted = events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 7)

  return (
    <div className="m-panel">
      <h3 className="text-[18px] font-extrabold mb-3.5 text-[var(--color-ink)]">Activity</h3>

      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--color-neutral-700)] py-2">No activity yet for {studentName}.</p>
      ) : (
        sorted.map(event => (
          <div key={event.id} className="py-[11px] border-t border-[var(--color-neutral-300)]">
            <div className="flex items-baseline justify-between gap-2.5">
              <p
                className="text-[13px] font-semibold m-num"
                style={{ color: event.type === 'payment' ? 'var(--color-ledger)' : 'var(--color-ink)' }}
              >
                {event.description}
              </p>
              <p className="text-xs text-[var(--color-neutral-700)] m-num flex-shrink-0">
                {formatDateTime(event.timestamp)}
              </p>
            </div>
            {event.detail && (
              <p className="text-xs text-[var(--color-neutral-700)] mt-[3px]">{event.detail}</p>
            )}
          </div>
        ))
      )}

      <a
        href={`/today/record?search=${encodeURIComponent(studentName)}`}
        className="block text-[13px] font-semibold text-[var(--color-signal-text)] hover:underline mt-3.5 pt-3.5 border-t border-[var(--color-neutral-300)]"
      >
        View full record
      </a>
    </div>
  )
}
