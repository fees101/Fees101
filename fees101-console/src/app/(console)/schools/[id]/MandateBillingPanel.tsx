import { getMandateBillingSummary } from '@/lib/queries'
import DeactivateMandateButton from './DeactivateMandateButton'

// Key-facts panel for the direct-debit billing model (the current collection
// mechanism — supersedes the DVA model shown in CollectionPanel). Server
// component: fetches platform_billing's mandate/setup-fee fields directly, so
// the owner can see a school's billing setup without going into Supabase.
// Mostly read-only; BillingPanel still owns the legacy action buttons. The
// one action here is DeactivateMandateButton, a founder-initiated hard stop
// for when a school leaves and the mandate must be cancelled at Paystack
// right away rather than waiting on the recurring-debit cron.

const FREE_DAYS = 65 // kept in sync by hand with fees101-web's cycle.ts

function naira(n: number) {
  return '₦' + Math.round(n).toLocaleString('en-NG')
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

function Tag({ label, tone }: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const cls = tone === 'neutral' ? 'tag' : `tag tag-${tone}`
  return <span className={cls}>{label}</span>
}

function setupFeeTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'paid') return 'good'
  if (status === 'pending') return 'warn'
  if (status === 'failed') return 'bad'
  return 'neutral'
}

function mandateTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'active') return 'good'
  if (status === 'pending') return 'warn'
  if (status === 'failed' || status === 'revoked') return 'bad'
  return 'neutral'
}

function billingStatusTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'active') return 'good'
  if (status === 'payment_due' || status === 'grace') return 'warn'
  if (status === 'suspended') return 'bad'
  return 'neutral'
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{children}</div>
    </div>
  )
}

export default async function MandateBillingPanel({ schoolId }: { schoolId: string }) {
  const s = await getMandateBillingSummary(schoolId)

  let freePeriodText = '—'
  if (s.onboardingAt) {
    const daysElapsed = Math.floor((Date.now() - new Date(s.onboardingAt).getTime()) / 86_400_000)
    freePeriodText = daysElapsed < FREE_DAYS
      ? `${FREE_DAYS - daysElapsed} days left`
      : 'billing live'
  }

  return (
    <div className="panel" style={{ padding: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Direct debit billing — key setup facts (current model)
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <Fact label="Setup fee">
          <Tag label={s.setupFeeStatus} tone={setupFeeTone(s.setupFeeStatus)} /> {naira(s.setupFeeAmount)}
        </Fact>
        <Fact label="Mandate">
          <Tag label={s.mandateStatus} tone={mandateTone(s.mandateStatus)} />
        </Fact>
        <Fact label="Billing status">
          <Tag label={s.billingStatus} tone={billingStatusTone(s.billingStatus)} />
        </Fact>

        <Fact label="Mandate email">{s.mandateEmail || '—'}</Fact>
        <Fact label="Authorization code">{s.mandateAuthorizationCodeMasked || '—'}</Fact>
        <Fact label="Free period">{freePeriodText}</Fact>

        <Fact label="Setup fee paid">{fmtDate(s.setupFeePaidAt)}</Fact>
        <Fact label="Mandate active since">{fmtDate(s.mandateActiveAt)}</Fact>
        <Fact label="Billing connected">{fmtDate(s.billingConnectedAt)}</Fact>

        <Fact label="Next debit due">{fmtDate(s.nextChargeDueAt)}</Fact>
        <Fact label="Last charge">
          {s.lastChargedAt ? `${naira(s.lastChargeAmount || 0)} · ${fmtDate(s.lastChargedAt)}` : '—'}
        </Fact>
        <Fact label="Terms accepted">
          {s.termsAcceptedAt ? `v${s.termsVersion || '?'} · ${fmtDate(s.termsAcceptedAt)}` : '—'}
        </Fact>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Recent direct-debit charges</div>
        {s.recentCharges.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '6px 8px', fontWeight: 500 }}>Amount</th>
                <th style={{ padding: '6px 8px', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '6px 8px', fontWeight: 500 }}>Charged by</th>
                <th style={{ padding: '6px 8px', fontWeight: 500 }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {s.recentCharges.map(c => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>{naira(c.amount)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <Tag label={c.status} tone={c.status === 'success' ? 'good' : c.status === 'failed' ? 'bad' : 'warn'} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>{c.chargedBy || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{fmtDate(c.paidAt ?? c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>No direct-debit charges yet.</p>
        )}
      </div>

      {s.mandateAuthorizationCodeMasked && s.mandateStatus !== 'cancelled' && s.mandateStatus !== 'revoked' && (
        <DeactivateMandateButton schoolId={schoolId} />
      )}
    </div>
  )
}
