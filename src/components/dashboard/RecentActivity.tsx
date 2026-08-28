import Link from 'next/link'

interface ActivityEvent {
  id: string
  type: 'payment' | 'invoice_generated'
  amount?: number
  timestamp: string
  description: string
}

interface RecentActivityProps {
  events: ActivityEvent[]
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function timeAgo(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function getDotColor(type: ActivityEvent['type']): string {
  switch (type) {
    case 'payment': return 'bg-mint'
    case 'invoice_generated': return 'bg-navy'
  }
}

function getEventIcon(type: ActivityEvent['type']) {
  switch (type) {
    case 'payment':
      return (
        <div className="w-8 h-8 rounded-full bg-mint-light flex items-center justify-center flex-shrink-0">
          <span className="text-mint font-bold text-sm">₦</span>
        </div>
      )
    case 'invoice_generated':
      return (
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
      )
  }
}

export default function RecentActivity({ events }: RecentActivityProps) {
  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 h-full flex flex-col">
      <h2 className="text-navy font-semibold text-lg mb-4">Recent activity</h2>

      {events.length === 0 ? (
        <p className="text-gray-500 text-sm py-8 text-center flex-1">
          No activity yet.
        </p>
      ) : (
        <div className="flex-1">
          <div className="space-y-4">
            {events.map((event, index) => (
              <div key={event.id} className="relative flex items-start gap-3 pl-5">
                {/* Dot on timeline */}
                <div className={`absolute left-0 top-2.5 w-2.5 h-2.5 rounded-full ${getDotColor(event.type)} ring-2 ring-white z-10`}></div>
                
                {/* Vertical line connecting to next dot */}
                {index < events.length - 1 && (
                  <div className="absolute left-[5px] top-5 w-px bg-gray-200" style={{ height: 'calc(100% + 16px - 1.25rem)' }}></div>
                )}
                
                {/* Icon */}
                {getEventIcon(event.type)}
                
                {/* Content + time */}
                <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-navy leading-snug">
                      {event.description}
                    </p>
                    {event.amount !== undefined && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatNaira(event.amount)}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
                    {timeAgo(event.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {events.length > 0 && (
        <Link href="/activity" className="mt-4 text-sm text-mint font-medium hover:underline flex items-center gap-1 self-start">
          View full activity →
        </Link>
      )}
    </div>
  )
}