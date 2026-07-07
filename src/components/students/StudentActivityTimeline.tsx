import { createClient } from '@/lib/supabase/server'

interface StudentActivityTimelineProps {
  studentId: string
  studentName: string
  parentName: string
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp)
  const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  return `${dateStr}, ${timeStr}`
}

export default async function StudentActivityTimeline({ 
  studentId, 
  studentName, 
  parentName 
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
    .select('id, total_amount, generated_at, billing_cycles(name)')
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
      detail: payment.provider_reference ? `Receipt #${payment.provider_reference}` : payment.method.replace('_', ' '),
      timestamp: payment.paid_at,
    })
  })

  invoices?.forEach(invoice => {
    events.push({
      id: `invoice-${invoice.id}`,
      type: 'invoice',
      description: `Invoice sent to ${parentName}`,
      // @ts-expect-error — joined object
      detail: invoice.billing_cycles?.name || '',
      timestamp: invoice.generated_at,
    })
  })

  // Sort all events by timestamp descending, then limit to 7
  const sorted = events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 7)

  if (sorted.length === 0) {
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200">
        <h2 className="text-navy font-semibold text-lg mb-4">Recent activity</h2>
        <p className="text-gray-500 text-sm py-4">No activity yet for {studentName}.</p>
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200">
      <h2 className="text-navy font-semibold text-lg mb-4">Recent activity</h2>
      
      <div className="space-y-4">
        {sorted.map((event, index) => (
          <div key={event.id} className="relative flex items-center gap-3 pl-5">
            {/* Dot on timeline */}
            <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${event.type === 'payment' ? 'bg-mint' : 'bg-navy'} ring-2 ring-white z-10`}></div>
            
            {/* Vertical line connecting */}
            {index < sorted.length - 1 && (
              <div className="absolute left-[5px] top-1/2 w-px bg-gray-200" style={{ height: 'calc(100% + 16px)' }}></div>
            )}
            
            {/* Icon */}
            <div className={`w-8 h-8 rounded-full ${event.type === 'payment' ? 'bg-mint-light' : 'bg-gray-100'} flex items-center justify-center flex-shrink-0`}>
              {event.type === 'payment' ? (
                <span className="text-mint font-bold text-sm">₦</span>
              ) : (
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            
            {/* Content */}
            <div className="flex-1 flex items-center justify-between gap-3 min-w-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <p className="text-sm text-navy">{event.description}</p>
                {event.detail && (
                  <>
                    <span className="text-gray-400 font-bold">·</span>
                    <p className="text-sm text-gray-500 truncate">{event.detail}</p>
                  </>
                )}
              </div>
              <p className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">
                {formatDateTime(event.timestamp)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}