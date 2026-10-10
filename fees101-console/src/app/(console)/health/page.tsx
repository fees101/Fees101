import Link from 'next/link'
import { getHealthSummary, getSchoolUsageOutliers } from '@/lib/opsQueries'
import { ArrowRight } from '@/lib/icons'

// Payments & health landing — previously just redirected straight to
// /health/jobs with no overview of its own ("a heavy explorer doesn't belong
// in a tab bar" was the right call for the FOUR sub-pages, but it left the
// parent page with nothing to say for itself). Full pass 2026-10-10: this is
// now a real "is anything on fire" cross-cutting summary — one stat strip
// spanning all four areas, then a preview card per area linking to its full
// explorer — consistent with how Home is the overview and Schools is the
// list one level below it (docs/platform-dashboard-architecture.md's own
// pattern, applied here to Health's own four sub-areas).

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const BAD_WEBHOOK_STATUSES = new Set(['error', 'failed', 'invalid_signature', 'expired'])

export default async function HealthOverviewPage() {
  const [health, usage] = await Promise.all([getHealthSummary(), getSchoolUsageOutliers()])
  const flaggedSchools = usage.schools.filter(s => s.flags.length > 0)

  const stats = [
    { label: 'Stuck jobs', value: health.jobs.stuckCount, href: '/health/jobs', tone: health.jobs.stuckCount > 0 ? 'warn' : 'good' },
    { label: 'Failed jobs, 30d', value: health.jobs.failedCount, href: '/health/jobs', tone: health.jobs.failedCount > 0 ? 'warn' : 'good' },
    { label: 'Webhook errors, 30d', value: health.webhooks.recentProblems.length, href: '/health/webhooks', tone: health.webhooks.recentProblems.length > 0 ? 'warn' : 'good' },
    { label: 'SMS/email unmatched, 7d', value: health.smsWebhooks.unmatchedCount, href: '/health/webhooks', tone: health.smsWebhooks.unmatchedCount > 0 ? 'warn' : 'good' },
    { label: 'Stalled rollovers', value: health.rollovers.stalledCount, href: '/health/rollovers', tone: health.rollovers.stalledCount > 0 ? 'bad' : 'good' },
    { label: 'Usage outliers', value: flaggedSchools.length, href: '/health/usage', tone: flaggedSchools.length > 0 ? 'warn' : 'good' },
  ]
  const allClear = stats.every(s => s.value === 0)

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div className="kicker">Operations</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Payments &amp; health</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          {allClear ? 'Everything is clean — no stuck jobs, webhook errors, stalled rollovers, or usage outliers.' : 'Engineer/on-call view across every school — background jobs, webhook delivery, usage outliers, year-end rollovers.'}
        </p>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {stats.map(s => (
          <Link key={s.label} href={s.href} className="stat" style={{ display: 'block' }}>
            <span className="kicker">{s.label}</span>
            <div className="stat-value" style={{ color: s.tone === 'good' ? 'var(--good-text)' : s.tone === 'bad' ? 'var(--bad-text)' : 'var(--warn-text)' }}>{s.value}</div>
          </Link>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div className="section-head" style={{ marginTop: 0 }}>
            <h2>Background jobs</h2>
            <Link href="/health/jobs" className="btn btn-ghost btn-sm">Full explorer <ArrowRight size={12} /></Link>
          </div>
          <div className="panel">
            {health.jobs.problemRows.length === 0 ? (
              <div style={{ padding: '18px 16px', color: 'var(--muted)', fontSize: 13 }}>No stuck or failed jobs in the last 30 days.</div>
            ) : (
              <table>
                <thead><tr><th>School</th><th>Type</th><th>Status</th><th>Updated</th></tr></thead>
                <tbody>
                  {health.jobs.problemRows.slice(0, 6).map(j => (
                    <tr key={j.id}>
                      <td style={{ fontWeight: 600 }}>{j.schoolName}</td>
                      <td>{j.jobType}</td>
                      <td><span className={`tag ${j.stuck ? 'tag-warn' : j.status === 'failed' ? 'tag-bad' : j.failed > 0 ? 'tag-warn' : 'tag-good'}`}><span className="dot" />{j.stuck ? 'stuck' : j.status}</span></td>
                      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(j.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="section-head" style={{ marginTop: 0 }}>
            <h2>Webhook delivery</h2>
            <Link href="/health/webhooks" className="btn btn-ghost btn-sm">Full explorer <ArrowRight size={12} /></Link>
          </div>
          <div className="panel">
            {health.webhooks.recentProblems.length === 0 ? (
              <div style={{ padding: '18px 16px', color: 'var(--muted)', fontSize: 13 }}>No webhook errors in the last 30 days.</div>
            ) : (
              <table>
                <thead><tr><th>School</th><th>Event</th><th>Status</th><th>Received</th></tr></thead>
                <tbody>
                  {health.webhooks.recentProblems.slice(0, 6).map(w => (
                    <tr key={w.id}>
                      <td style={{ fontWeight: 600 }}>{w.schoolName}</td>
                      <td>{w.provider} {w.eventType || ''}</td>
                      <td><span className={`tag ${BAD_WEBHOOK_STATUSES.has(w.status) ? 'tag-bad' : 'tag-warn'}`}><span className="dot" />{w.status}</span></td>
                      <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(w.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="section-head"><h2>Usage outliers</h2>
            <Link href="/health/usage" className="btn btn-ghost btn-sm">Full explorer <ArrowRight size={12} /></Link>
          </div>
          <div className="panel">
            {flaggedSchools.length === 0 ? (
              <div style={{ padding: '18px 16px', color: 'var(--muted)', fontSize: 13 }}>No school is a disproportionate usage outlier right now.</div>
            ) : (
              <table>
                <thead><tr><th>School</th><th>Flag</th></tr></thead>
                <tbody>
                  {flaggedSchools.slice(0, 6).map(s => (
                    <tr key={s.schoolId}>
                      <td style={{ fontWeight: 600, verticalAlign: 'top' }}>{s.schoolName}</td>
                      <td style={{ color: 'var(--muted)' }}>{s.flags[0]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="section-head"><h2>Year-end rollovers</h2>
            <Link href="/health/rollovers" className="btn btn-ghost btn-sm">Full explorer <ArrowRight size={12} /></Link>
          </div>
          <div className="panel">
            {health.rollovers.stalled.length === 0 ? (
              <div style={{ padding: '18px 16px', color: 'var(--muted)', fontSize: 13 }}>No school has a rollover stuck mid-run.</div>
            ) : (
              <table>
                <thead><tr><th>School</th><th>Step</th><th>Status</th></tr></thead>
                <tbody>
                  {health.rollovers.stalled.slice(0, 6).map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.schoolName}</td>
                      <td>{r.step}</td>
                      <td><span className={`tag ${r.status === 'failed' ? 'tag-bad' : 'tag-warn'}`}><span className="dot" />{r.status}</span></td>
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
