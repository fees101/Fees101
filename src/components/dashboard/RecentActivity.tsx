import Link from 'next/link'

interface ActivityEvent {
  id: string
  type: 'payment' | 'invoice_generated'
  name: string
  line: string
  tone: 'ledger' | 'neutral'
  timestamp: string
}

interface RecentActivityProps {
  events: ActivityEvent[]
}

// Time-of-day for today, a plain word for yesterday, a short date beyond that.
// Digits stay tabular so the right column lines up.
function formatWhen(timestamp: string): string {
  const then = new Date(timestamp)
  const now = new Date()
  const sameDay = then.toDateString() === now.toDateString()
  if (sameDay) return then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function RecentActivity({ events }: RecentActivityProps) {
  return (
    <section className="m-panel">
      <div className="flex items-baseline justify-between mb-3.5">
        <h2 className="text-[18px] font-extrabold text-[var(--color-ink)]">Record</h2>
        <Link
          href="/today/record"
          className="text-[12px] tracking-[0.06em] uppercase text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]"
        >
          Full record →
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-[var(--color-neutral-700)]">No activity yet.</p>
      ) : (
        events.map(event => (
          <div key={event.id} className="m-row py-[11px]">
            <div className="flex items-baseline justify-between gap-2.5">
              <p className="text-[13px] font-semibold text-[var(--color-ink)] truncate">{event.name}</p>
              <p className="text-[12px] text-[var(--color-neutral-700)] whitespace-nowrap flex-shrink-0 m-num">
                {formatWhen(event.timestamp)}
              </p>
            </div>
            <p className={`text-[13px] mt-[3px] m-num ${event.tone === 'ledger' ? 'text-[var(--color-ledger)]' : 'text-[var(--color-neutral-800)]'}`}>
              {event.line}
            </p>
          </div>
        ))
      )}
    </section>
  )
}
