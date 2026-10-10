import Link from 'next/link'
import { getMoneyOversight, MoneyOversightRow, MoneySectionFilters } from '@/lib/opsQueries'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import Tabs from '@/components/Tabs'
import MoneyFilterForm from '@/components/MoneyFilterForm'

// Cross-tenant VISIBILITY into refunds, manual payments, and discounts —
// money workflows that today have zero console-side presence. Deliberately
// read-only: no approve/reject here. ROADMAP.md states this twice for
// refunds and manual payments alike ("console has no approve UI anywhere" —
// each school's own staff review their own money decisions); the same
// reasoning extends to discounts, so this page is a dashboard, not a queue.
//
// Each of the three sections is independently filterable (status/school/date)
// and server-side paginated via `${prefix}Status`/`${prefix}School`/
// `${prefix}From`/`${prefix}To`/`${prefix}Page` query params — same .range()
// + count:'exact' shape as /audit, just three of them sharing one URL since
// all three tabs render at once (Tabs is client-side show/hide, no refetch).

function naira(n: number) { return '₦' + Math.round(n).toLocaleString('en-NG') }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function statusTag(status: string) {
  const good = new Set(['completed', 'approved', 'applied', 'paid'])
  const bad = new Set(['rejected', 'failed'])
  const cls = good.has(status) ? 'tag-good' : bad.has(status) ? 'tag-bad' : 'tag-warn'
  return <span className={`tag ${cls}`}><span className="dot" />{status}</span>
}

type MoneySearchParams = Record<string, string | undefined>

function buildQuery(sp: MoneySearchParams, overrides: MoneySearchParams) {
  const merged: MoneySearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function filtersFor(sp: MoneySearchParams, prefix: string): MoneySectionFilters {
  return {
    status: sp[`${prefix}Status`],
    schoolId: sp[`${prefix}School`],
    from: sp[`${prefix}From`],
    to: sp[`${prefix}To`],
    page: Math.max(1, parseInt(sp[`${prefix}Page`] || '1', 10) || 1),
  }
}

const PAGE_SIZE = 20

function Section({ title, tabKey, prefix, sp, schools, statusCounts, thisMonthTotal, rows, total, page, methodLabel }: {
  title: string
  tabKey: string
  prefix: string
  sp: MoneySearchParams
  schools: { id: string; name: string }[]
  statusCounts: Record<string, number>
  thisMonthTotal: number
  rows: MoneyOversightRow[]
  total: number
  page: number
  methodLabel: string
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filters = filtersFor(sp, prefix)

  return (
    <div className="panel" style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '2px solid var(--rule)' }}>
        <span style={{ fontWeight: 800 }}>{title}</span>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{naira(thisMonthTotal)} this month</span>
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px', flexWrap: 'wrap' }}>
        {Object.entries(statusCounts).map(([status, count]) => (
          <span key={status} className="tag tag-accent">{status}: {count}</span>
        ))}
        {Object.keys(statusCounts).length === 0 && <span style={{ color: 'var(--muted)', fontSize: 13 }}>No records.</span>}
      </div>

      <MoneyFilterForm
        tabKey={tabKey}
        prefix={prefix}
        schools={schools}
        statusOptions={Object.keys(statusCounts)}
        status={filters.status}
        schoolId={filters.schoolId}
        from={filters.from}
        to={filters.to}
      />

      {rows.length === 0 ? (
        <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No records match this filter.</div>
      ) : (
        <table>
          <thead><tr><th>School</th><th>Amount</th><th>{methodLabel}</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}><Link href={`/schools/${r.schoolId}`}>{r.schoolName}</Link></td>
                <td>{naira(r.amount)}</td>
                <td>{r.method || r.category || '—'}</td>
                <td>{statusTag(r.status)}</td>
                <td>{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>
        <span>{total} matching {total === 1 ? 'record' : 'records'} · page {page} of {totalPages}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {page > 1 && <Link href={buildQuery(sp, { tab: tabKey, [`${prefix}Page`]: String(page - 1) })} className="btn btn-ghost">Previous</Link>}
          {page < totalPages && <Link href={buildQuery(sp, { tab: tabKey, [`${prefix}Page`]: String(page + 1) })} className="btn btn-ghost">Next</Link>}
        </div>
      </div>
    </div>
  )
}

type PageProps = { searchParams: Promise<MoneySearchParams> }

export default async function MoneyOversightPage({ searchParams }: PageProps) {
  const sp = await searchParams

  const [data, schoolsResult] = await Promise.all([
    getMoneyOversight({
      refunds: filtersFor(sp, 'refunds'),
      manualPayments: filtersFor(sp, 'manual'),
      discounts: filtersFor(sp, 'discounts'),
    }),
    createServiceRoleClient().from('schools').select('id, name').order('name'),
  ])
  const schools = schoolsResult.data || []
  const combinedThisMonth = data.refunds.thisMonthTotal + data.manualPayments.thisMonthTotal + data.discounts.thisMonthTotal
  const pendingCount = (section: typeof data.refunds) =>
    Object.entries(section.statusCounts).filter(([s]) => s === 'pending' || s === 'requested').reduce((sum, [, c]) => sum + c, 0)

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div className="kicker">Money oversight</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Refunds, manual payments & discounts</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6, maxWidth: 680 }}>
          Cross-tenant visibility only. Each school&rsquo;s own staff request and approve these — the console never gets an approve/reject surface for a single school&rsquo;s day-to-day money decisions.
        </p>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat">
          <span className="kicker">All three, this month</span>
          <div className="stat-value">{naira(combinedThisMonth)}</div>
          <div className="stat-sub">refunds + manual payments + discounts</div>
        </div>
        <div className="stat">
          <span className="kicker">Refunds, this month</span>
          <div className="stat-value">{naira(data.refunds.thisMonthTotal)}</div>
          <div className="stat-sub">{pendingCount(data.refunds)} pending (all-time)</div>
        </div>
        <div className="stat">
          <span className="kicker">Manual payments, this month</span>
          <div className="stat-value">{naira(data.manualPayments.thisMonthTotal)}</div>
          <div className="stat-sub">{pendingCount(data.manualPayments)} pending (all-time)</div>
        </div>
        <div className="stat">
          <span className="kicker">Discounts, this month</span>
          <div className="stat-value">{naira(data.discounts.thisMonthTotal)}</div>
          <div className="stat-sub">{pendingCount(data.discounts)} pending (all-time)</div>
        </div>
      </div>

      <Tabs
        defaultKey={sp.tab || 'refunds'}
        tabs={[
          {
            key: 'refunds',
            label: 'Refunds',
            count: data.refunds.total,
            content: (
              <Section title="Refunds" tabKey="refunds" prefix="refunds" sp={sp} schools={schools}
                statusCounts={data.refunds.statusCounts} thisMonthTotal={data.refunds.thisMonthTotal}
                rows={data.refunds.rows} total={data.refunds.total} page={filtersFor(sp, 'refunds').page || 1}
                methodLabel="Method" />
            ),
          },
          {
            key: 'manual',
            label: 'Manual / cash payments',
            count: data.manualPayments.total,
            content: (
              <Section title="Manual / cash payments" tabKey="manual" prefix="manual" sp={sp} schools={schools}
                statusCounts={data.manualPayments.statusCounts} thisMonthTotal={data.manualPayments.thisMonthTotal}
                rows={data.manualPayments.rows} total={data.manualPayments.total} page={filtersFor(sp, 'manual').page || 1}
                methodLabel="Method" />
            ),
          },
          {
            key: 'discounts',
            label: 'Discounts',
            count: data.discounts.total,
            content: (
              <Section title="Discounts" tabKey="discounts" prefix="discounts" sp={sp} schools={schools}
                statusCounts={data.discounts.statusCounts} thisMonthTotal={data.discounts.thisMonthTotal}
                rows={data.discounts.rows} total={data.discounts.total} page={filtersFor(sp, 'discounts').page || 1}
                methodLabel="Category" />
            ),
          },
        ]}
      />
    </div>
  )
}
