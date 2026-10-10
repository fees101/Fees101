import Link from 'next/link'
import { getBackgroundJobs, getHealthSummary } from '@/lib/opsQueries'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Background jobs — stuck/failed jobs across every school, now filterable
// (school/status/job type) — 2026-10-10, closing the one health sub-page that
// had no filter UI at all (the others — webhooks, usage, rollovers — already
// had one or didn't need one). Lets a school's own detail page deep-link
// "this school's jobs" via ?school=, and a job type worth watching can be
// isolated instead of scanning the full 30-day problem list by eye.

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const STATUS_OPTIONS = ['stuck', 'running', 'failed', 'completed']
const PAGE_SIZE = 50

type SearchParams = { school?: string; status?: string; jobType?: string; page?: string }

function buildQuery(sp: SearchParams, overrides: SearchParams) {
  const merged: SearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

type PageProps = { searchParams: Promise<SearchParams> }

export default async function BackgroundJobsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)

  const [summary, jobsResult, schoolsResult] = await Promise.all([
    getHealthSummary(),
    getBackgroundJobs({ schoolId: sp.school, status: sp.status, jobType: sp.jobType, page }),
    createServiceRoleClient().from('schools').select('id, name').order('name'),
  ])
  const schools = schoolsResult.data || []
  const totalPages = Math.max(1, Math.ceil(jobsResult.total / PAGE_SIZE))
  const hasFilters = !!(sp.school || sp.status || sp.jobType)

  const kpis = [
    { label: 'Running jobs', value: summary.jobs.runningCount },
    { label: 'Stuck jobs (1hr+)', value: summary.jobs.stuckCount },
    { label: 'Failed jobs (30d)', value: summary.jobs.failedCount },
  ]

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div className="kicker">Payments &amp; health</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Background jobs</h1>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {kpis.map(k => (
          <div key={k.label} className="stat">
            <span className="kicker">{k.label}</span>
            <div className="stat-value">{k.value}</div>
          </div>
        ))}
      </div>

      <form method="get" className="panel" style={{ display: 'flex', gap: 10, padding: 14, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label className="field-label">School</label>
          <select name="school" defaultValue={sp.school || ''} className="field">
            <option value="">All schools</option>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Status</label>
          <select name="status" defaultValue={sp.status || ''} className="field">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Job type</label>
          <select name="jobType" defaultValue={sp.jobType || ''} className="field">
            <option value="">All types</option>
            {jobsResult.jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">Filter</button>
        {hasFilters && <Link href="/health/jobs" className="btn btn-ghost">Clear</Link>}
      </form>

      <div className="panel">
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
          Jobs, last 30 days — {jobsResult.total} matching
        </div>
        {jobsResult.rows.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No jobs match this filter.</div>
        ) : (
          <table>
            <thead><tr><th>School</th><th>Type</th><th>Status</th><th>Progress</th><th>Error</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {jobsResult.rows.map(j => {
                const errorPreview = j.error || (j.failures[0]?.error ?? null)
                const extraFailures = j.failures.length > 1 ? ` (+${j.failures.length - 1} more)` : ''
                return (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 600 }}>{j.schoolName}</td>
                    <td>{j.jobType}</td>
                    <td><span className={`tag ${j.stuck ? 'tag-warn' : j.status === 'failed' ? 'tag-bad' : j.failed > 0 ? 'tag-warn' : 'tag-good'}`}><span className="dot" />{j.stuck ? 'stuck' : j.status}</span></td>
                    <td>{j.processed}/{j.total}{j.failed ? ` (${j.failed} failed)` : ''}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {/* maxWidth/ellipsis on a <td> itself is not a hard cap under table-layout:auto —
                          a cell with white-space:nowrap has minimum-content-width == its full unwrapped
                          text width, so the browser widens the whole table/page rather than truncate
                          (found 2026-10-10: a long unbroken error string blew webhooks out to 1802px on
                          a 1536px viewport). Constraining a nested block instead works because its
                          max-width properly bounds the intrinsic size contributed to column sizing. */}
                      <div style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {errorPreview ? `${errorPreview}${extraFailures}` : '—'}
                      </div>
                    </td>
                    <td>{fmtDate(j.updatedAt)}</td>
                    <td><Link href={`/health/jobs/${j.id}`} className="btn btn-ghost btn-sm">Details</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
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
