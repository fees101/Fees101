import Link from 'next/link'
import { getProviderFeeRevenue } from '@/lib/businessQueries'

// Provider fee REVENUE — distinct from the "Platform processing volume"
// section on Home (gross ₦ Fees101 moves through Paystack/Monnify). This is
// how much of that volume the PROCESSOR keeps as its own fee: the number
// that matters for the aggregator pitch (owner, 2026-10-10 follow-up) —
// "if ₦1,000,000 has been transacted, the number that matters is how much
// Paystack kept as fee (e.g. ₦30,000) — because that's the revenue Fees101
// could capture/redirect if it became the aggregator instead." Also doubles
// as a plain "biggest accounts" view via the per-school breakdown below.
//
// Lives under Payments & health (not Billing) — this is a processor-fee
// signal read off `payments`, the same cross-tenant payments-health surface
// as Jobs/Webhooks/Usage/Rollovers, not Fees101's own billing of schools.
//
// Honesty gate: a row's provider_fee can be null (predates live capture, or
// the provider could never verify it — see fees101-web's
// backfillProviderFees.ts) — every total here is shown ALONGSIDE a coverage
// count, never silently treated as ₦0.

function naira(n: number) { return '₦' + Math.round(n).toLocaleString('en-NG') }
function pct(n: number | null, digits = 2) { return n === null ? '—' : `${(n * 100).toFixed(digits)}%` }
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
}

const PROVIDER_LABEL: Record<string, string> = { paystack: 'Paystack', monnify: 'Monnify' }

export default async function ProviderFeesPage() {
  const revenue = await getProviderFeeRevenue()

  const coveragePct = revenue.totalTxnsTotal > 0 ? revenue.totalTxnsWithFee / revenue.totalTxnsTotal : null
  const gap = revenue.totalTxnsTotal - revenue.totalTxnsWithFee

  // Chart data — same "flat (provider, month) rows back into one column per
  // month" approach as Home's processing-volume chart.
  const monthOrder = Array.from(new Set(revenue.byMonth.map(r => r.month))).sort()
  const providerNames = Array.from(new Set(revenue.byProvider.map(p => p.provider))).sort()
  const monthCols = monthOrder.map(month => {
    const segments = providerNames.map(provider => ({
      provider,
      amount: revenue.byMonth.find(r => r.month === month && r.provider === provider)?.feeRevenue || 0,
    }))
    return { month, segments, total: segments.reduce((s, seg) => s + seg.amount, 0) }
  })
  const maxMonthTotal = Math.max(1, ...monthCols.map(c => c.total))
  // Real categorical palette, looked up by provider NAME — see the matching
  // comment on Home's processing-volume chart for why (same-hue shades were
  // too close to read apart, and indexing a per-column *filtered* array let
  // a provider's colour drift between months). Kept identical here so the
  // same provider reads as the same colour across both pages.
  const CHART_PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
  const providerColor = new Map(providerNames.map((p, i) => [p, CHART_PALETTE[i % CHART_PALETTE.length]]))

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div className="kicker">Payments & health</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Provider fee revenue</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4, maxWidth: 760 }}>
          How much of the ₦ Fees101 moves through Paystack/Monnify, the processor itself keeps as its own fee — the
          revenue Fees101 could capture or redirect if it became the aggregator/facilitator instead of each school
          being a separate merchant. See &ldquo;Platform processing volume&rdquo; on <Link href="/" style={{ textDecoration: 'underline' }}>Home</Link> for
          the gross ₦ moved — this is a different number, the processor&rsquo;s cut of it.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 20, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {revenue.totalTxnsTotal === 0
            ? 'No processed transactions yet.'
            : gap === 0
              ? `All ${revenue.totalTxnsTotal.toLocaleString('en-NG')} transactions have fee data captured.`
              : `${revenue.totalTxnsWithFee.toLocaleString('en-NG')} of ${revenue.totalTxnsTotal.toLocaleString('en-NG')} transactions have fee data captured (${pct(coveragePct, 0)}) — the remaining ${gap.toLocaleString('en-NG')} predate live capture or could not be verified at the provider, and are excluded from the totals below rather than counted as ₦0.`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap' }}>
          {revenue.computedVia === 'sql' ? 'Live SQL aggregate' : 'Live aggregate (SQL migration pending — see db/platform_provider_fee_revenue.sql)'}
        </span>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: `repeat(${Math.max(1, revenue.byProvider.length + 1)}, 1fr)` }}>
        <div className="stat" style={{ background: 'var(--panel-2)' }}>
          <span className="kicker">All providers combined</span>
          <div className="stat-value">{naira(revenue.totalFeeRevenue)}</div>
          <div className="stat-sub">on {naira(revenue.totalGrossVolume)} moved · {pct(revenue.totalGrossVolume > 0 ? revenue.totalFeeRevenue / revenue.totalGrossVolume : null)} effective rate</div>
        </div>
        {revenue.byProvider.map(p => (
          <div key={p.provider} className="stat">
            <span className="kicker">{PROVIDER_LABEL[p.provider] || p.provider}</span>
            <div className="stat-value">{naira(p.feeRevenue)}</div>
            <div className="stat-sub">{pct(p.effectiveRate)} of {naira(p.grossVolume)} · {p.txnsWithFee.toLocaleString('en-NG')}/{p.txnsTotal.toLocaleString('en-NG')} txns</div>
          </div>
        ))}
        {revenue.byProvider.length === 0 && (
          <div className="stat"><span className="kicker">No processed payments yet</span><div className="stat-value">—</div></div>
        )}
      </div>

      <div className="panel" style={{ padding: 18, marginBottom: 28 }}>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
          Effective rate is fee revenue ÷ volume moved — a sanity check against each provider&rsquo;s published
          schedule. Today&rsquo;s collection is almost entirely bank-transfer/DVA, confirmed live at 1% capped ₦300
          per transfer (ROADMAP.md, 2026-09-27) — a rate noticeably below that on a school with larger average
          transfers is expected (the ₦300 cap kicks in above ~₦30,000); a rate noticeably above it is worth a second
          look. Card/Terminal collection carries a different published schedule (≈1%–1.5%, capped ₦1,000–₦2,000)
          and will pull the blended rate up as that volume grows.
        </p>

        {monthCols.some(c => c.total > 0) ? (
          <>
            <div className="kicker" style={{ marginBottom: 10 }}>Monthly trend{providerNames.length > 1 ? ' (stacked by provider)' : ''}</div>
            <div className="bar-chart">
              {monthCols.map(col => (
                <div key={col.month} className="bar-chart-col">
                  <div className="bar-chart-value">{col.total > 0 ? naira(col.total) : ''}</div>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column-reverse', height: '100%', justifyContent: 'flex-start' }}>
                    {col.segments.filter(s => s.amount > 0).map(s => (
                      <div
                        key={s.provider}
                        className="bar-chart-bar"
                        style={{ height: `${Math.max(2, (s.amount / maxMonthTotal) * 100)}%`, background: providerColor.get(s.provider) }}
                        title={`${PROVIDER_LABEL[s.provider] || s.provider}: ${naira(s.amount)}`}
                      />
                    ))}
                  </div>
                  <div className="bar-chart-label">{new Date(col.month + '-02').toLocaleDateString('en-NG', { month: 'short' })}</div>
                </div>
              ))}
            </div>
            {providerNames.length > 1 && (
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                {providerNames.map(p => (
                  <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)' }}>
                    <span style={{ width: 9, height: 9, background: providerColor.get(p), display: 'inline-block' }} />
                    {PROVIDER_LABEL[p] || p}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No fee revenue recorded in the trailing 12 months yet.</div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="kicker">Per school</div>
          <h2>Biggest accounts by fee revenue</h2>
        </div>
      </div>
      <div className="panel">
        {revenue.bySchool.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No processed payments yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>School</th><th>Provider</th><th>Fee revenue</th><th>Volume moved</th>
                  <th>Effective rate</th><th>Transactions</th><th>Fee data coverage</th>
                </tr>
              </thead>
              <tbody>
                {revenue.bySchool.map(s => {
                  const rate = s.grossVolume > 0 ? s.feeRevenue / s.grossVolume : null
                  const full = s.txnsTotal > 0 && s.txnsWithFee === s.txnsTotal
                  return (
                    <tr key={`${s.schoolId}::${s.provider}`}>
                      <td style={{ fontWeight: 600 }}><Link href={`/schools/${s.schoolId}`}>{s.schoolName}</Link></td>
                      <td>{PROVIDER_LABEL[s.provider] || s.provider}</td>
                      <td>{naira(s.feeRevenue)}</td>
                      <td>{naira(s.grossVolume)}</td>
                      <td>{pct(rate)}</td>
                      <td>{s.txnsTotal.toLocaleString('en-NG')}</td>
                      <td>
                        {full ? (
                          <span className="tag tag-good"><span className="dot" />{s.txnsWithFee}/{s.txnsTotal}</span>
                        ) : (
                          <span className="tag tag-warn"><span className="dot" />{s.txnsWithFee}/{s.txnsTotal}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {revenue.byProvider.length > 0 && (
        <div style={{ marginTop: 20, fontSize: 11.5, color: 'var(--faint)' }}>
          {revenue.byProvider.map(p => (
            <div key={p.provider}>
              {PROVIDER_LABEL[p.provider] || p.provider}: first processed {fmtDate(p.firstPaymentAt)}, most recent {fmtDate(p.lastPaymentAt)}.
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
