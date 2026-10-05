import Link from 'next/link'
import { getSchoolsOverview, getSchoolsNotOnMandate } from '@/lib/queries'
import { AlertTriangle, Building2, Users, ArrowRight } from '@/lib/icons'

// The operator's morning screen — overview, never a raw list. See
// docs/platform-dashboard-architecture.md §4.1. Revenue/collection KPIs will
// join platform_billing_periods once accrual data exists; v1 shows what's
// derivable now (tenant + student counts, status mix) + the attention queue.
function naira(n: number) { return '₦' + Math.round(n).toLocaleString('en-NG') }

const NEEDS_ATTENTION = new Set(['payment_due', 'grace', 'suspended'])
const STATUS_TAG: Record<string, string> = {
  active: 'tag-good', payment_due: 'tag-warn', grace: 'tag-warn',
  suspended: 'tag-bad', cancelled: 'tag',
}

export default async function OverviewPage() {
  const schools = await getSchoolsOverview()
  const offMandate = await getSchoolsNotOnMandate()

  const totalSchools = schools.length
  const totalStudents = schools.reduce((s, r) => s + r.studentCount, 0)
  const byStatus = schools.reduce<Record<string, number>>((m, r) => {
    m[r.billingStatus] = (m[r.billingStatus] || 0) + 1; return m
  }, {})
  const attention = schools.filter(r => NEEDS_ATTENTION.has(r.billingStatus))

  const kpis = [
    { label: 'Schools', value: String(totalSchools), sub: `${byStatus.active || 0} active · ${(byStatus.suspended || 0)} suspended`, icon: Building2 },
    { label: 'Billable students', value: totalStudents.toLocaleString('en-NG'), sub: 'active across all schools', icon: Users },
    { label: 'Needs attention', value: String(attention.length), sub: 'schools off "active" billing', icon: AlertTriangle },
  ]

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div className="kicker">Overview</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Control plane</h1>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', marginBottom: 26 }}>
        {kpis.map(k => (
          <div key={k.label} className="kpi" style={{ background: 'var(--panel)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="kicker">{k.label}</span>
              <k.icon size={15} color="var(--faint)" />
            </div>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Needs attention */}
      <div className="panel" style={{ marginBottom: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '2px solid var(--rule)' }}>
          <span style={{ fontWeight: 800 }}>Needs attention</span>
          <Link href="/schools" className="btn btn-ghost" style={{ padding: '4px 8px' }}>All schools <ArrowRight size={14} /></Link>
        </div>
        {attention.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>Nothing needs attention — every school is on active billing. ✓</div>
        ) : (
          <table>
            <thead><tr><th>School</th><th>Status</th><th>Students</th><th></th></tr></thead>
            <tbody>
              {attention.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td><span className={`tag ${STATUS_TAG[s.billingStatus] || 'tag'}`}><span className="dot" />{s.billingStatus.replace('_', ' ')}</span></td>
                  <td>{s.studentCount}</td>
                  <td style={{ textAlign: 'right' }}><Link href={`/schools/${s.id}`} className="btn btn-ghost" style={{ padding: '4px 8px' }}>Open <ArrowRight size={13} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Not on auto-debit mandate — the retention rail. Schools here have
          connected billing but sit on bank transfer (DVA) or an inactive /
          deactivated mandate, so the owner reaches out to move them onto
          auto-debit. */}
      <div className="panel" style={{ marginBottom: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '2px solid var(--rule)' }}>
          <span style={{ fontWeight: 800 }}>Not on auto-debit mandate</span>
          <Link href="/schools" className="btn btn-ghost" style={{ padding: '4px 8px' }}>All schools <ArrowRight size={14} /></Link>
        </div>
        {offMandate.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>Every connected school is on an active auto-debit mandate.</div>
        ) : (
          <table>
            <thead><tr><th>School</th><th>Current rail</th><th></th></tr></thead>
            <tbody>
              {offMandate.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.rail}</td>
                  <td style={{ textAlign: 'right' }}><Link href={`/schools/${s.id}`} className="btn btn-ghost" style={{ padding: '4px 8px' }}>Open <ArrowRight size={13} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ color: 'var(--faint)', fontSize: 12 }}>
        Revenue &amp; collection KPIs, growth trend, and recent platform activity land here once billing periods accrue — see the architecture plan.
      </div>
    </div>
  )
}
