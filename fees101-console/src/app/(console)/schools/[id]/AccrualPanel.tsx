import { getCurrentBillingSummary } from '@/lib/accrual'

// Read-only accrual summary for a school. Server component: it fetches the
// current billing summary directly (service-role client) and renders it.
// Standalone — the parent page wires it in; it does not touch BillingPanel.

function naira(n: number) {
  return '₦' + (Math.round(n * 100) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function AccrualPanel({ schoolId }: { schoolId: string }) {
  const summary = await getCurrentBillingSummary(schoolId)

  if (!summary.billingActive) {
    return (
      <div className="panel" style={{ padding: 20 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Daily accrual (v2 pro-rata)</p>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Not billing yet — set an onboarding date on this school to start the 65-day free / 300-day billed cycle.
        </p>
      </div>
    )
  }

  const isFree = summary.phase === 'free'
  const badgeLabel = isFree
    ? `Free period — ${summary.daysRemainingInPhase} days left`
    : `Billing — ${summary.daysRemainingInPhase} days left in cycle`
  const badgeColor = isFree ? 'var(--muted)' : 'var(--accent)'

  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Daily accrual (v2 pro-rata — ₦{summary.pricePerStudentMonth}/student/month)</p>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: badgeColor,
            border: `1px solid ${badgeColor}`,
            borderRadius: 999,
            padding: '3px 12px',
            whiteSpace: 'nowrap',
          }}
        >
          {badgeLabel}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Active students today</p>
          <p style={{ fontSize: 20, fontWeight: 700 }}>{summary.activeStudentsToday}</p>
        </div>
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Accruing today</p>
          <p style={{ fontSize: 20, fontWeight: 700 }}>{isFree ? '—' : naira(summary.dailyAccrualToday)}</p>
        </div>
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Month-to-date accrued</p>
          <p style={{ fontSize: 20, fontWeight: 700 }}>{naira(summary.monthToDateAccrued)}</p>
        </div>
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>This period&rsquo;s amount due</p>
          <p style={{ fontSize: 20, fontWeight: 700 }}>
            {summary.period ? naira(summary.period.amountDue) : '—'}
          </p>
          {summary.period && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, textTransform: 'capitalize' }}>
              {summary.period.periodStart} → {summary.period.periodEnd} · {summary.period.status}
            </p>
          )}
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
        Cycle day {summary.phaseDay + 1} of 365 · {isFree ? `day ${summary.daysElapsedInPhase + 1} of the free window` : `day ${summary.daysElapsedInPhase + 1} of billing`}
      </p>
    </div>
  )
}
