import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdmin } from '@/lib/auth'
import { getBillingOverviewPage } from '@/lib/accrual'
import { getBusinessRevenue, getPlatformWideStats, estimateTax } from '@/lib/businessQueries'
import { Download, ArrowRight } from '@/lib/icons'

// Billing — the actual financial hub, not just a per-school accrual table.
// Full rebuild 2026-10-10. This page went through three states today: a
// first pass built a full revenue/financial-analytics section here; a second
// pass reverted it back to a bare per-school accrual table while Home grew
// its own (duplicate) revenue summary; this pass resolves the duplication the
// way Home's own header now states it: Home carries a short "what changed"
// pulse and links HERE for the full picture, and this page owns the complete
// financial story — Fees101's own revenue (KPIs, monthly trend, by kind, top
// schools, tax estimate, money owed to us) stacked above the per-school
// billing table, which now uses the already-built getBillingOverviewPage
// (search + status filter + real pagination) instead of rendering every
// school unfiltered. Sectioned by headings, not tabs — this reads as one
// continuous financial report, the way Finance would actually want it, per
// docs/platform-dashboard-architecture.md §4.3.

function naira(n: number) {
  return '₦' + Math.round(n).toLocaleString('en-NG')
}
function naira2(n: number) {
  return '₦' + (Math.round(n * 100) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}
function monthLabel(key: string) {
  return new Date(key + '-02').toLocaleDateString('en-NG', { month: 'short' })
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--good-text)',
  payment_due: 'var(--warn-text)',
  grace: 'var(--warn-text)',
  suspended: 'var(--bad-text)',
  cancelled: 'var(--muted)',
}

const STATUS_OPTIONS = ['active', 'payment_due', 'grace', 'suspended', 'cancelled']
const PER_PAGE = 20

type SearchParams = { q?: string; status?: string; page?: string }

function buildQuery(sp: SearchParams, overrides: SearchParams) {
  const merged: SearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

type PageProps = { searchParams: Promise<SearchParams> }

export default async function BillingPage({ searchParams }: PageProps) {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)

  const [revenue, platformStats, billingPage] = await Promise.all([
    getBusinessRevenue(),
    getPlatformWideStats(),
    getBillingOverviewPage({ page, perPage: PER_PAGE, statusFilter: sp.status, q: sp.q }),
  ])

  const tax = estimateTax(revenue.allTime, revenue.monthsOfOperation)
  const { rows: schoolRows, total: schoolTotal } = billingPage
  const totalPages = Math.max(1, Math.ceil(schoolTotal / PER_PAGE))
  const maxMonth = Math.max(1, ...revenue.byMonth.map(m => m.amount))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="kicker">Billing</div>
          <h1 style={{ fontSize: 24, marginTop: 6 }}>Fees101&rsquo;s financial picture</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4, maxWidth: 620 }}>
            Revenue Fees101 has actually collected from schools for using the platform, projected run-rate, who owes us money, and the per-school billing/accrual detail.
          </p>
        </div>
      </div>

      {/* Revenue KPIs. */}
      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat">
          <span className="kicker">All-time revenue</span>
          <div className="stat-value">{naira(revenue.allTime)}</div>
          <div className="stat-sub">since {fmtDate(revenue.earliestChargeAt)}</div>
        </div>
        <div className="stat">
          <span className="kicker">Month to date</span>
          <div className="stat-value">{naira(revenue.monthToDate)}</div>
          <div className="stat-sub">last 30 days: {naira(revenue.last30Days)}</div>
        </div>
        <div className="stat">
          <span className="kicker">Projected run-rate / month</span>
          <div className="stat-value">{naira(revenue.projectedMonthlyRunRate)}</div>
          <div className="stat-sub">active students × price, schools on the accrual path</div>
        </div>
        <div className="stat">
          <span className="kicker">Owed to us, outstanding</span>
          <div className="stat-value">{naira(revenue.overdueToUs.reduce((s, r) => s + r.amountOwed, 0))}</div>
          <div className="stat-sub">{revenue.overdueToUs.length} open/overdue period{revenue.overdueToUs.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat">
          <span className="kicker">Active students, platform-wide</span>
          <div className="stat-value">{platformStats.totalActiveStudents.toLocaleString('en-NG')}</div>
          <div className="stat-sub">{platformStats.totalFamilies.toLocaleString('en-NG')} families</div>
        </div>
        <div className="stat">
          <span className="kicker">Gross parent-payment volume, MTD</span>
          <div className="stat-value">{naira(platformStats.grossPaymentVolumeThisMonth)}</div>
          <div className="stat-sub">{naira(platformStats.grossPaymentVolumeAllTime)} all-time</div>
        </div>
        <div className="stat">
          <span className="kicker">Billing active</span>
          <div className="stat-value">{platformStats.activeBillingSchools}</div>
          <div className="stat-sub">{platformStats.suspendedSchools} suspended</div>
        </div>
        <div className="stat">
          <span className="kicker">Tax estimate (annualized)</span>
          <div className="stat-value">{naira(tax.vatEstimate + tax.citEstimate + tax.developmentLevyEstimate)}</div>
          <div className="stat-sub">VAT + CIT + levy — unverified, see below</div>
        </div>
      </div>

      <div className="section-head">
        <h2>Revenue, trailing 7 months</h2>
      </div>
      <div className="panel" style={{ padding: 18, marginBottom: 8 }}>
        {revenue.byMonth.every(m => m.amount === 0) ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>No revenue recorded yet.</div>
        ) : (
          <div className="bar-chart">
            {revenue.byMonth.map(m => (
              <div key={m.month} className="bar-chart-col">
                <div className="bar-chart-value">{m.amount > 0 ? naira(m.amount) : ''}</div>
                <div className="bar-chart-bar" style={{ height: `${Math.max(2, (m.amount / maxMonth) * 100)}%` }} />
                <div className="bar-chart-label">{monthLabel(m.month)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, marginBottom: 8 }}>
        <div>
          <div className="section-head" style={{ marginTop: 32 }}><h2>Revenue by kind</h2></div>
          <div className="panel">
            {revenue.byKind.length === 0 ? (
              <div style={{ padding: '18px 16px', color: 'var(--muted)', fontSize: 13 }}>No charges yet.</div>
            ) : (
              <table>
                <thead><tr><th>Kind</th><th>Amount</th><th>Charges</th></tr></thead>
                <tbody>
                  {revenue.byKind.map(k => (
                    <tr key={k.chargedBy}>
                      <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{k.chargedBy.replace('_', ' ')}</td>
                      <td>{naira(k.amount)}</td>
                      <td>{k.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="section-head" style={{ marginTop: 32 }}><h2>Top schools by lifetime revenue</h2></div>
          <div className="panel">
            {revenue.bySchool.length === 0 ? (
              <div style={{ padding: '18px 16px', color: 'var(--muted)', fontSize: 13 }}>No charges yet.</div>
            ) : (
              <table>
                <thead><tr><th>School</th><th>Lifetime revenue</th><th>Last paid</th></tr></thead>
                <tbody>
                  {revenue.bySchool.map(s => (
                    <tr key={s.schoolId}>
                      <td style={{ fontWeight: 600 }}><Link href={`/schools/${s.schoolId}`}>{s.schoolName}</Link></td>
                      <td>{naira(s.lifetimeRevenue)}</td>
                      <td style={{ color: 'var(--muted)' }}>{fmtDate(s.lastPaidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="section-head">
        <h2>Owed to us — open, overdue &amp; partial periods</h2>
      </div>
      <div className="panel" style={{ marginBottom: 8 }}>
        {revenue.overdueToUs.length === 0 ? (
          <div style={{ padding: '18px 16px', color: 'var(--muted)', fontSize: 13 }}>Nothing outstanding — every billing period is settled.</div>
        ) : (
          <table>
            <thead><tr><th>School</th><th>Billing status</th><th>Period</th><th>Amount owed</th><th>Next charge due</th><th></th></tr></thead>
            <tbody>
              {revenue.overdueToUs.map(r => (
                <tr key={`${r.schoolId}-${r.periodStart}`}>
                  <td style={{ fontWeight: 600 }}>{r.schoolName}</td>
                  <td><span className={`tag ${r.billingStatus === 'suspended' ? 'tag-bad' : 'tag-warn'}`}><span className="dot" />{r.billingStatus.replace('_', ' ')}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
                  <td style={{ fontWeight: 600 }}>{naira(r.amountOwed)}</td>
                  <td style={{ color: 'var(--muted)' }}>{fmtDate(r.nextChargeDueAt)}</td>
                  <td style={{ textAlign: 'right' }}><Link href={`/schools/${r.schoolId}`} className="btn btn-ghost btn-sm">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-head">
        <h2>Tax estimate</h2>
      </div>
      <div className="panel" style={{ padding: 18, marginBottom: 8 }}>
        <p style={{ fontSize: 12, color: 'var(--warn-text)', fontWeight: 600, marginBottom: 12 }}>
          Unverified estimate — rough planning figure only, not a filing-ready number. Confirm with an accountant before relying on this.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>Annualized revenue basis</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{naira(tax.basisAnnualizedRevenue)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>VAT (7.5%)</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{naira(tax.vatEstimate)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>Companies income tax</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{tax.isLikelySmallCompany ? 'Exempt (small company)' : naira(tax.citEstimate)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>Development levy</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{tax.isLikelySmallCompany ? 'Exempt (small company)' : naira(tax.developmentLevyEstimate)}</div>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h2>Per-school billing — {schoolTotal} school{schoolTotal === 1 ? '' : 's'}</h2>
        <a href={`/billing/export${buildQuery(sp, {})}`} className="btn btn-ghost btn-sm"><Download size={13} /> Export CSV</a>
      </div>
      <form method="get" style={{ display: 'flex', gap: 10, marginBottom: 1, flexWrap: 'wrap', alignItems: 'flex-end' }} className="panel">
        <div style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', width: '100%' }}>
          <div>
            <label className="field-label">Search school</label>
            <input type="text" name="q" defaultValue={sp.q || ''} placeholder="School name…" className="field" style={{ width: 200 }} />
          </div>
          <div>
            <label className="field-label">Billing status</label>
            <select name="status" defaultValue={sp.status || ''} className="field">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary">Filter</button>
          {(sp.q || sp.status) && <Link href="/billing" className="btn btn-ghost">Clear</Link>}
        </div>
      </form>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>Active students</th>
              <th>Price/student/month</th>
              <th>Billing path</th>
              <th>Accrued this month</th>
              <th>Billing status</th>
            </tr>
          </thead>
          <tbody>
            {schoolRows.map(r => (
              <tr key={r.schoolId}>
                <td>
                  <Link href={`/schools/${r.schoolId}`} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }}>
                    {r.schoolName}
                  </Link>
                </td>
                <td>{r.activeStudentCount}</td>
                <td>{naira2(r.pricePerStudentMonth)}</td>
                <td>{r.onAccrualPath ? 'Per-student accrual' : <span style={{ color: 'var(--muted)' }}>Legacy flat fee</span>}</td>
                <td>{r.onAccrualPath ? naira2(r.monthToDateAccrued) : <span style={{ color: 'var(--muted)' }}>{'—'}</span>}</td>
                <td>
                  <span style={{ color: STATUS_COLOR[r.billingStatus] || 'var(--muted)', fontWeight: 600, textTransform: 'capitalize' }}>
                    {r.billingStatus.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
            {schoolRows.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>No schools match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>
          <span>Page {page} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {page > 1 && <Link href={buildQuery(sp, { page: String(page - 1) })} className="btn btn-ghost">Previous</Link>}
            {page < totalPages && <Link href={buildQuery(sp, { page: String(page + 1) })} className="btn btn-ghost">Next</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
