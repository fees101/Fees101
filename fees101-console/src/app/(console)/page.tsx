import Link from 'next/link'
import { getSchoolsOverview, getSchoolsNotOnMandate } from '@/lib/queries'
import { getPlatformAuditLog, getHealthSummary } from '@/lib/opsQueries'
import { getBusinessRevenue, getPlatformWideStats, getPlatformProcessingVolume } from '@/lib/businessQueries'
import { AlertTriangle, Building2, Users, ArrowRight, TrendingUp, Search } from '@/lib/icons'

// The operator's morning screen — docs/platform-dashboard-architecture.md §4.1.
//
// Full-pass rebuild, 2026-10-10. Earlier same-day passes tried (1) leading
// with the full revenue breakdown, then (2) a "business pulse" strip with the
// three tenant-ops lists hidden behind tabs. Owner feedback on (2) ("why's
// there so much blank space") was correct: hiding three SHORT, glanceable
// lists from each other behind a tab bar means only one is ever visible at a
// time, on a page with plenty of width to show all of them — the tab bar was
// making the emptiness worse, not fixing it. Tabs removed here in favour of
// a stacked/side-by-side layout; every list is visible without a click.
//
// Also closes two real gaps against docs/platform-dashboard-architecture.md
// §4.1: (a) "a search / jump-to-school box... so the full list isn't needed
// here" — was never built; added below. (b) the needs-attention queue was
// defined there as "schools overdue/suspended... broken payment config,
// failed webhooks... stuck background jobs" but only ever showed billing
// status — it silently missed a school with a stuck job or broken webhooks
// but otherwise-fine billing. Now merges billing-status attention with the
// same signals Payments & health already computes (no new queries).

function naira(n: number) { return '₦' + Math.round(n).toLocaleString('en-NG') }
function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const NEEDS_ATTENTION = new Set(['payment_due', 'grace', 'suspended'])
const STATUS_TAG: Record<string, string> = {
  active: 'tag-good', payment_due: 'tag-warn', grace: 'tag-warn',
  suspended: 'tag-bad', cancelled: 'tag',
}

interface AttentionRow {
  kind: string
  tone: 'bad' | 'warn'
  school: string
  detail: string
  href: string
  when: string | null
}

export default async function OverviewPage() {
  const [schools, offMandate, recentActivity, revenue, platformStats, health, processingVolume] = await Promise.all([
    getSchoolsOverview(),
    getSchoolsNotOnMandate(),
    getPlatformAuditLog({ page: 1 }),
    getBusinessRevenue(),
    getPlatformWideStats(),
    getHealthSummary(),
    getPlatformProcessingVolume(),
  ])

  const totalSchools = schools.length
  const billingAttention = schools.filter(r => NEEDS_ATTENTION.has(r.billingStatus))

  // New this month — real signal of growth, not a static headcount.
  const now = new Date()
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const newThisMonth = schools.filter(s => new Date(s.createdAt).getTime() >= monthStart).length

  // Revenue growth, month over month — derived from the same series Billing
  // charts in full; here it's just the one number that signals direction.
  const months = revenue.byMonth
  const thisMonthRev = months[months.length - 1]?.amount ?? 0
  const lastMonthRev = months[months.length - 2]?.amount ?? 0
  const revenueGrowthPct = lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 1000) / 10 : null

  const onMandateCount = totalSchools - offMandate.length
  const mandateAdoptionPct = totalSchools > 0 ? Math.round((onMandateCount / totalSchools) * 100) : 0

  const pulse = [
    { label: 'New schools this month', value: String(newThisMonth), sub: `${totalSchools} total`, icon: Building2 },
    {
      label: 'Revenue vs last month',
      value: revenueGrowthPct === null ? '—' : `${revenueGrowthPct >= 0 ? '+' : ''}${revenueGrowthPct}%`,
      sub: revenueGrowthPct === null ? 'not enough history yet' : `${naira(thisMonthRev)} this month`,
      icon: TrendingUp,
    },
    { label: 'Needs attention', value: String(billingAttention.length + health.jobs.stuckCount + health.jobs.failedCount + health.rollovers.stalledCount), sub: 'billing, jobs, webhooks, rollovers', icon: AlertTriangle },
    { label: 'Auto-debit adoption', value: `${mandateAdoptionPct}%`, sub: `${onMandateCount} of ${totalSchools} schools`, icon: Users },
  ]

  const scale = [
    { label: 'Active students', value: platformStats.totalActiveStudents.toLocaleString('en-NG'), sub: `${platformStats.totalFamilies.toLocaleString('en-NG')} families` },
    { label: 'Gross volume, month to date', value: naira(platformStats.grossPaymentVolumeThisMonth), sub: `${naira(platformStats.grossPaymentVolumeAllTime)} all-time` },
    { label: 'Billing active', value: String(platformStats.activeBillingSchools), sub: `${platformStats.suspendedSchools} suspended` },
    {
      label: 'Payment providers',
      value: `${platformStats.paystackSchools + platformStats.monnifySchools} connected`,
      sub: platformStats.unconfiguredSchools > 0 ? `${platformStats.unconfiguredSchools} school(s) unconfigured` : 'every school configured',
    },
  ]

  // Unified needs-attention queue — billing status + the same job/webhook/
  // rollover problem signals Payments & health computes. Capped per kind so
  // one noisy category can't crowd the others out of view; a footer links to
  // the full explorer when a kind has more than what's shown here.
  const attentionRows: AttentionRow[] = [
    ...billingAttention.map(s => ({
      kind: 'Billing', tone: 'bad' as const, school: s.name,
      detail: `${s.billingStatus.replace('_', ' ')} · ${s.studentCount} student${s.studentCount === 1 ? '' : 's'}`,
      href: `/schools/${s.id}`, when: null,
    })),
    ...health.jobs.problemRows.slice(0, 5).map(j => ({
      kind: 'Background job', tone: 'warn' as const, school: j.schoolName,
      detail: `${j.jobType} — ${j.stuck ? 'stuck' : j.status}${j.failed ? ` (${j.failed} failed)` : ''}`,
      href: `/health/jobs/${j.id}`, when: j.updatedAt,
    })),
    ...health.webhooks.recentProblems.slice(0, 5).map(w => ({
      kind: 'Webhook', tone: 'warn' as const, school: w.schoolName,
      detail: `${w.provider} ${w.eventType || ''} — ${w.status}`,
      href: `/health/webhooks/${w.id}`, when: w.receivedAt,
    })),
    ...health.rollovers.stalled.slice(0, 5).map(r => ({
      kind: 'Rollover', tone: 'warn' as const, school: r.schoolName,
      detail: `${r.step} — ${r.status}`,
      href: '/health/rollovers', when: r.updatedAt,
    })),
  ]
  const attentionTruncated = health.jobs.problemRows.length > 5 || health.webhooks.recentProblems.length > 5 || health.rollovers.stalled.length > 5

  // Processing-volume chart data — group the flat (provider, month) rows back
  // into one column per month, each holding every provider's amount so the
  // bar can be split by provider.
  const monthOrder = Array.from(new Set(processingVolume.byMonth.map(r => r.month))).sort()
  const providerNames = Array.from(new Set(processingVolume.byProvider.map(p => p.provider))).sort()
  const monthCols = monthOrder.map(month => {
    const segments = providerNames.map(provider => ({
      provider,
      amount: processingVolume.byMonth.find(r => r.month === month && r.provider === provider)?.amount || 0,
    }))
    return { month, segments, total: segments.reduce((s, seg) => s + seg.amount, 0) }
  })
  const maxMonthTotal = Math.max(1, ...monthCols.map(c => c.total))
  // Real categorical palette (2026-10-10 follow-up) — same-hue shades of
  // --accent read as near-identical in an actual stacked bar (owner
  // feedback). Colour is looked up by provider NAME, not by position in a
  // per-column filtered array: a month where one provider has ₦0 must not
  // shift the remaining providers' colour, or a provider's bar silently
  // changes colour between columns and stops matching its own legend swatch.
  const CHART_PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
  const providerColor = new Map(providerNames.map((p, i) => [p, CHART_PALETTE[i % CHART_PALETTE.length]]))
  const PROVIDER_LABEL: Record<string, string> = { paystack: 'Paystack', monnify: 'Monnify' }

  return (
    <div>
      <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="kicker">Overview</div>
          <h1 style={{ fontSize: 24, marginTop: 6 }}>Fees101 business</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <form action="/schools" method="get" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel)', border: '1px solid var(--border)', padding: '6px 10px' }}>
            <Search size={14} color="var(--faint)" />
            <input name="q" placeholder="Jump to a school…" className="field" style={{ background: 'transparent', border: 0, padding: 0, width: 190 }} />
          </form>
          <Link href="/billing" className="btn btn-ghost">Full financial picture <ArrowRight size={14} /></Link>
        </div>
      </div>

      {/* Business pulse — what changed, not a static headcount. */}
      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {pulse.map(k => (
          <div key={k.label} className="stat">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="kicker">{k.label}</span>
              <k.icon size={14} color="var(--faint)" />
            </div>
            <div className="stat-value">{k.value}</div>
            <div className="stat-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Platform scale — the headcount/volume context a founder dashboard
          needs that a billing-only view misses (2026-10-10 addition). */}
      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {scale.map(k => (
          <div key={k.label} className="stat">
            <span className="kicker">{k.label}</span>
            <div className="stat-value">{k.value}</div>
            <div className="stat-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="section-head">
        <div>
          <div className="kicker">Aggregator pitch numbers</div>
          <h2>Platform processing volume</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <Link href="/health/provider-fees" className="btn btn-ghost btn-sm">Provider fee revenue <ArrowRight size={12} /></Link>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>
            {processingVolume.computedVia === 'sql' ? 'Live SQL aggregate' : 'Live aggregate (SQL migration pending — see db/platform_processing_volume.sql)'}
          </span>
        </div>
      </div>
      <div className="panel" style={{ padding: 18, marginBottom: 28 }}>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 18, maxWidth: 760 }}>
          This is gross ₦ volume, not revenue — see <Link href="/health/provider-fees" style={{ textDecoration: 'underline' }}>provider fee revenue</Link> for how much of it the processor keeps.{' '}
          Total ₦ volume Fees101 already moves through each payment processor on schools&rsquo; behalf — the numbers for an aggregator/facilitator conversation with Paystack or Monnify. Gross volume (not net of refunds), since that&rsquo;s what a processor measures too.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, processingVolume.byProvider.length + 1)}, 1fr)`, gap: 1, background: 'var(--border)', border: '1px solid var(--border)', marginBottom: 22 }}>
          <div className="stat" style={{ background: 'var(--panel-2)' }}>
            <span className="kicker">All providers combined</span>
            <div className="stat-value">{naira(processingVolume.totalAllTimeAmount)}</div>
            <div className="stat-sub">{processingVolume.totalAllTimeTxnCount.toLocaleString('en-NG')} transactions, all-time</div>
          </div>
          {processingVolume.byProvider.map(p => {
            const activeSchools = processingVolume.activeSchoolsThisMonth.find(a => a.provider === p.provider)?.activeSchools ?? 0
            return (
              <div key={p.provider} className="stat">
                <span className="kicker">{PROVIDER_LABEL[p.provider] || p.provider}</span>
                <div className="stat-value">{naira(p.totalAmount)}</div>
                <div className="stat-sub">{p.txnCount.toLocaleString('en-NG')} txns · {activeSchools} school{activeSchools === 1 ? '' : 's'} processing this month</div>
              </div>
            )
          })}
          {processingVolume.byProvider.length === 0 && (
            <div className="stat"><span className="kicker">No processed payments yet</span><div className="stat-value">—</div></div>
          )}
        </div>

        {monthCols.some(c => c.total > 0) && (
          <>
            <div className="kicker" style={{ marginBottom: 10 }}>Monthly trend, trailing 13 months{providerNames.length > 1 ? ' (stacked by provider)' : ''}</div>
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
        )}
      </div>

      <div className="section-head">
        <div>
          <div className="kicker">Tenant operations</div>
          <h2>Needs attention — {attentionRows.length}{attentionTruncated ? '+' : ''}</h2>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 28 }}>
        {attentionRows.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>Nothing needs attention — billing, jobs, webhooks and rollovers are all clean.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Kind</th><th>School</th><th>Detail</th><th>When</th><th></th></tr></thead>
              <tbody>
                {attentionRows.map((r, i) => (
                  <tr key={i}>
                    <td><span className={`tag ${r.tone === 'bad' ? 'tag-bad' : 'tag-warn'}`}><span className="dot" />{r.kind}</span></td>
                    <td style={{ fontWeight: 600 }}>{r.school}</td>
                    <td style={{ color: 'var(--muted)' }}>{r.detail}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.when ? fmtWhen(r.when) : '—'}</td>
                    <td style={{ textAlign: 'right' }}><Link href={r.href} className="btn btn-ghost btn-sm">Open <ArrowRight size={12} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {attentionTruncated && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
            <Link href="/health/jobs" className="btn btn-ghost btn-sm">Full detail in Payments &amp; health <ArrowRight size={12} /></Link>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20 }}>
        <div>
          <div className="section-head" style={{ marginTop: 0 }}>
            <h2>Not on auto-debit — {offMandate.length}</h2>
          </div>
          <div className="panel">
            {offMandate.length === 0 ? (
              <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>Every connected school is on an active auto-debit mandate.</div>
            ) : (
              <table>
                <thead><tr><th>School</th><th>Current rail</th><th></th></tr></thead>
                <tbody>
                  {offMandate.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td style={{ color: 'var(--muted)' }}>{s.rail}</td>
                      <td style={{ textAlign: 'right' }}><Link href={`/schools/${s.id}`} className="btn btn-ghost btn-sm">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="section-head" style={{ marginTop: 0 }}>
            <h2>Recent activity</h2>
            <Link href="/audit" className="btn btn-ghost btn-sm">Full audit log <ArrowRight size={12} /></Link>
          </div>
          <div className="panel">
            {recentActivity.rows.length === 0 ? (
              <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No platform actions recorded yet.</div>
            ) : (
              <table>
                <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>School</th><th>Summary</th></tr></thead>
                <tbody>
                  {recentActivity.rows.slice(0, 8).map(r => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtWhen(r.createdAt)}</td>
                      <td style={{ fontWeight: 600 }}>{r.actorName}</td>
                      <td><span className="tag tag-accent">{r.action}</span></td>
                      <td>{r.schoolName ? <Link href={`/schools/${r.schoolId}`}>{r.schoolName}</Link> : '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{r.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
