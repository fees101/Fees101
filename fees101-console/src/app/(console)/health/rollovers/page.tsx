import { getHealthSummary } from '@/lib/opsQueries'

// Year-end rollovers — schools with a rollover currently in progress or that
// failed mid-run, plus (2026-10-10) the full run history below it. Before
// this pass the page only ever rendered the stalled list, so the moment
// nothing was stuck it went almost entirely blank — exactly the "why's there
// so much empty space" complaint, and the one sub-page under Health that
// wasn't a real explorer. rollover_runs is bounded by schools x years, so a
// full unfiltered history table is cheap and in no danger of growing into a
// pagination problem any time soon.

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const STATUS_TAG: Record<string, string> = {
  completed: 'tag-good',
  failed: 'tag-bad',
  in_progress: 'tag-warn',
}

export default async function RolloversPage() {
  const summary = await getHealthSummary()
  const { recent } = summary.rollovers

  const kpis = [
    { label: 'Stalled rollovers', value: summary.rollovers.stalledCount, tone: summary.rollovers.stalledCount > 0 ? 'bad' : 'good' },
    { label: 'Completed, all time', value: recent.filter(r => r.status === 'completed').length, tone: 'good' as const },
    { label: 'Failed, all time', value: recent.filter(r => r.status === 'failed').length, tone: recent.filter(r => r.status === 'failed').length > 0 ? 'warn' : 'good' },
    { label: 'Total runs recorded', value: recent.length, tone: 'neutral' as const },
  ]

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div className="kicker">Payments & health</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Year-end rollovers</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Every school runs its own year-end close independently — this is the full cross-school run history, not just the ones currently stuck.
        </p>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {kpis.map(k => (
          <div key={k.label} className="stat">
            <span className="kicker">{k.label}</span>
            <div className="stat-value" style={{ color: k.tone === 'good' ? 'var(--good-text)' : k.tone === 'bad' ? 'var(--bad-text)' : k.tone === 'warn' ? 'var(--warn-text)' : 'var(--ink)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>In progress or failed</h2>
      </div>
      <div className="panel" style={{ marginBottom: 26 }}>
        {summary.rollovers.stalled.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No school has a rollover stuck mid-run.</div>
        ) : (
          <table>
            <thead><tr><th>School</th><th>Step</th><th>Status</th><th>Error</th><th>Updated</th></tr></thead>
            <tbody>
              {summary.rollovers.stalled.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.schoolName}</td>
                  <td>{r.step}</td>
                  <td><span className={`tag ${r.status === 'failed' ? 'tag-bad' : 'tag-warn'}`}><span className="dot" />{r.status}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{r.errorDetail || '—'}</td>
                  <td>{fmtDate(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-head">
        <h2>Full run history — {recent.length} total</h2>
      </div>
      <div className="panel">
        {recent.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No school has run a year-end close yet.</div>
        ) : (
          <table>
            <thead><tr><th>School</th><th>Step</th><th>Status</th><th>Error</th><th>Started</th><th>Updated</th></tr></thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.schoolName}</td>
                  <td>{r.step}</td>
                  <td><span className={`tag ${STATUS_TAG[r.status] || 'tag'}`}><span className="dot" />{r.status}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{r.errorDetail || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
