import Link from 'next/link'
import { getPlatformAuditLog, getPlatformAuditFacets, getPlatformAuditStats, getAuditSeverity } from '@/lib/opsQueries'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { Download } from '@/lib/icons'

// Cross-tenant platform-level audit trail — docs/platform-dashboard-architecture.md
// §4.7. Separate from each school's own /settings/audit-log. Filterable by
// actor, action, school, date. Full pass 2026-10-10: the architecture doc
// names two concrete gaps for this exact page — "visual distinction for
// financial/sensitive actions" and "CSV export" — both closed here. Every
// row used to get the same neutral accent tag regardless of whether it was
// "a lead's status changed" or "someone impersonated a school owner", which
// is the one thing an audit log can't afford to flatten.

const SEVERITY_TAG: Record<string, string> = { critical: 'tag-bad', financial: 'tag-warn', routine: 'tag-accent' }
const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', financial: 'Financial', routine: 'Routine' }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type AuditSearchParams = { actor?: string; action?: string; school?: string; from?: string; to?: string; page?: string }

function buildQuery(sp: AuditSearchParams, overrides: AuditSearchParams) {
  const merged: AuditSearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function exportQuery(sp: AuditSearchParams) {
  const params = new URLSearchParams()
  Object.entries(sp).forEach(([k, v]) => { if (v && k !== 'page') params.set(k, v) })
  const qs = params.toString()
  return qs ? `/audit/export?${qs}` : '/audit/export'
}

type PageProps = {
  searchParams: Promise<AuditSearchParams>
}

export default async function AuditPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)

  const [facets, schoolsResult, { rows, total }, stats] = await Promise.all([
    getPlatformAuditFacets(),
    createServiceRoleClient().from('schools').select('id, name').order('name'),
    getPlatformAuditLog({ actor: sp.actor, action: sp.action, schoolId: sp.school, from: sp.from, to: sp.to, page }),
    getPlatformAuditStats(),
  ])
  const schools = schoolsResult.data || []

  const pageSize = 50
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const kpis = [
    { label: 'Entries, last 30d', value: stats.total30d, tone: 'neutral' as const },
    { label: 'Critical actions, 30d', value: stats.criticalCount30d, tone: stats.criticalCount30d > 0 ? 'bad' : 'good' as const },
    { label: 'Financial/DVA actions, 30d', value: stats.financialCount30d, tone: stats.financialCount30d > 0 ? 'warn' : 'good' as const },
    { label: 'Impersonation sessions, 30d', value: stats.impersonationCount30d, tone: stats.impersonationCount30d > 0 ? 'bad' : 'good' as const },
  ]

  return (
    <div>
      <div style={{ marginBottom: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="kicker">Audit log</div>
          <h1 style={{ fontSize: 24, marginTop: 6 }}>Platform audit log</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>Cross-tenant founder/internal actions — suspend, edit billing, impersonate, clear DVA, onboard. {total} matching {total === 1 ? 'entry' : 'entries'}.</p>
        </div>
        <Link href={exportQuery(sp)} className="btn btn-ghost"><Download size={14} /> Export CSV</Link>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {kpis.map(k => (
          <div key={k.label} className="stat">
            <span className="kicker">{k.label}</span>
            <div className="stat-value" style={{ color: k.tone === 'good' ? 'var(--good-text)' : k.tone === 'bad' ? 'var(--bad-text)' : k.tone === 'warn' ? 'var(--warn-text)' : 'var(--ink)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      <form method="get" className="panel" style={{ display: 'flex', gap: 10, padding: 14, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label className="field-label">Actor</label>
          <select name="actor" defaultValue={sp.actor || ''} className="field">
            <option value="">All actors</option>
            {facets.actors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Action</label>
          <select name="action" defaultValue={sp.action || ''} className="field">
            <option value="">All actions</option>
            {facets.actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">School</label>
          <select name="school" defaultValue={sp.school || ''} className="field">
            <option value="">All schools</option>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">From</label>
          <input type="date" name="from" defaultValue={sp.from ? sp.from.slice(0, 10) : ''} className="field" />
        </div>
        <div>
          <label className="field-label">To</label>
          <input type="date" name="to" defaultValue={sp.to ? sp.to.slice(0, 10) : ''} className="field" />
        </div>
        <button type="submit" className="btn btn-primary">Filter</button>
        {(sp.actor || sp.action || sp.school || sp.from || sp.to) && (
          <Link href="/audit" className="btn btn-ghost">Clear</Link>
        )}
      </form>

      <div className="panel">
        {rows.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No audit entries match this filter.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>When</th><th>Actor</th><th>Severity</th><th>Action</th><th>School</th><th>Summary</th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const severity = getAuditSeverity(r.action)
                  return (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.actorName}</td>
                      <td><span className={`tag ${SEVERITY_TAG[severity]}`}><span className="dot" />{SEVERITY_LABEL[severity]}</span></td>
                      <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>{r.action}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.schoolName ? <Link href={`/schools/${r.schoolId}`}>{r.schoolName}</Link> : '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{r.summary}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
