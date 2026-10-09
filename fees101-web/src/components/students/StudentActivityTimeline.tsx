import { createClient } from '@/lib/supabase/server'
import { paymentChannelLabel } from '@/lib/paymentMethod'
import { formatDateTime } from '@/lib/format/date'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getRefundsFeatureState } from '@/lib/queries/refunds'
import RefundRowAction from '@/components/refunds/RefundRowAction'

interface StudentActivityTimelineProps {
  studentId: string
  studentName: string
  parentName: string
}

function formatNaira(amount: number): string {
  // Reversals / corrections carry a negative amount — keep the minus ahead of
  // the currency mark (e.g. -₦20,000) so it never reads as money arriving.
  const sign = amount < 0 ? '-' : ''
  return sign + '₦' + Math.abs(amount).toLocaleString('en-NG')
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

  // Whether the "Refund this payment" action should render at all — needs
  // both the permission and the owner's liability acceptance (self-serve:
  // no per-school console toggle), same gate the request action re-checks
  // server-side.
  const [authCtx, refundsFeature] = await Promise.all([
    getAuthContext(),
    getRefundsFeatureState(),
  ])
  const canRequestRefund = !!authCtx && can(authCtx, 'request-refunds') && refundsFeature.liabilityAccepted

  // Get recent payments for this student
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount, method, paid_at, provider_reference, provider')
    .eq('student_id', studentId)
    .eq('match_status', 'matched')
    .order('paid_at', { ascending: false })
    .limit(4)

  // How much of each payment is still refundable (original amount minus any
  // completed/processing refund already against it) — found live 2026-10-09:
  // the Refund button used to show unconditionally on any automatic payment,
  // even one already refunded in FULL, with nothing left to refund. A
  // partially-refunded payment still correctly offers the remainder.
  const paymentIds = (payments || []).filter(p => p.provider).map(p => p.id)
  const refundedByPayment = new Map<string, number>()
  if (paymentIds.length > 0) {
    const { data: existingRefunds } = await supabase
      .from('refunds')
      .select('payment_id, amount')
      .in('payment_id', paymentIds)
      .in('status', ['completed', 'processing'])
    for (const r of existingRefunds || []) {
      refundedByPayment.set(r.payment_id, (refundedByPayment.get(r.payment_id) || 0) + Number(r.amount))
    }
  }

  // Get invoices for this student
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, total_amount, generated_at, sent_at, billing_cycles(name)')
    .eq('student_id', studentId)
    .order('generated_at', { ascending: false })
    .limit(4)

  // Sibling-to-sibling credit transfers move no real money and write no
  // payments row (just the two students' credit_balance figures), so without
  // this they'd never show up anywhere on either student's own page — audit_log
  // is the only record either side of the move was ever written.
  const { data: creditTransfers } = await supabase
    .from('audit_log')
    .select('id, summary, actor_name, created_at')
    .eq('target_type', 'student')
    .eq('target_id', studentId)
    .eq('action', 'student.family_credit_reallocated')
    .order('created_at', { ascending: false })
    .limit(4)

  type Event = {
    id: string
    type: 'payment' | 'invoice' | 'credit_transfer'
    reversal?: boolean
    description: string
    detail?: string
    timestamp: string
    // Only set for a real (provider) payment event — feeds the "Refund this
    // payment" row action.
    refundable?: { id: string; amount: number; paidAt: string }
  }

  const events: Event[] = []

  payments?.forEach(payment => {
    // A negative payment is a reversal / correction, not incoming money — label
    // it as such and render it in neutral ink (never ledger green) below.
    const amt = Number(payment.amount)
    const reversal = amt < 0
    const remaining = amt - (refundedByPayment.get(payment.id) || 0)
    events.push({
      id: `payment-${payment.id}`,
      type: 'payment',
      reversal,
      description: reversal
        ? `Reversal / correction · ${formatNaira(amt)}`
        : `${formatNaira(amt)} received from ${parentName}`,
      // Lead with the channel (how it was paid), then the receipt reference.
      detail: [paymentChannelLabel(payment.method), payment.provider_reference ? `Receipt #${payment.provider_reference}` : null]
        .filter(Boolean)
        .join(' · '),
      timestamp: payment.paid_at,
      refundable: (!reversal && payment.provider && remaining > 0) ? { id: payment.id, amount: remaining, paidAt: payment.paid_at } : undefined,
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

  creditTransfers?.forEach(entry => {
    events.push({
      id: `credit-${entry.id}`,
      type: 'credit_transfer',
      description: entry.summary,
      detail: entry.actor_name ? `By ${entry.actor_name}` : undefined,
      timestamp: entry.created_at,
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
                style={{ color: event.reversal ? 'var(--color-neutral-800)' : event.type === 'payment' ? 'var(--color-ledger)' : 'var(--color-ink)' }}
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
            {canRequestRefund && event.refundable && (
              <p className="mt-[5px]">
                <RefundRowAction payment={{ id: event.refundable.id, studentId, amount: event.refundable.amount, paidAt: event.refundable.paidAt }} />
              </p>
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
