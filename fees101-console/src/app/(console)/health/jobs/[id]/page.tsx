import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getBackgroundJobById } from '@/lib/opsQueries'

// Full detail for one background job — the full-error-text companion to the
// webhook detail page below. 2026-10-10 owner feedback: the Background jobs
// table's error cell was truncated to one line with no way to read the rest,
// and (the real bug) the query wasn't even selecting the `failures` column
// where per-item errors actually live — see opsQueries.ts's JobRow comment.

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const job = await getBackgroundJobById(id)
  if (!job) notFound()

  return (
    <div>
      <Link href="/health/jobs" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>&larr; Background jobs</Link>

      <div style={{ margin: '12px 0 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22 }}>{job.jobType}</h1>
        <span className={`tag ${job.stuck ? 'tag-warn' : job.status === 'failed' ? 'tag-bad' : job.status === 'completed' ? 'tag-good' : 'tag'}`}>
          <span className="dot" />{job.stuck ? 'stuck' : job.status}
        </span>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>Job details</div>
        <table>
          <tbody>
            <tr><td style={{ fontWeight: 600, width: 180 }}>School</td><td><Link href={`/schools/${job.schoolId}`}>{job.schoolName}</Link></td></tr>
            <tr><td style={{ fontWeight: 600 }}>Job ID</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{job.id}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>Progress</td><td>{job.processed}/{job.total}{job.failed ? ` (${job.failed} failed)` : ''}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>Created</td><td>{fmtDate(job.createdAt)}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>Updated</td><td>{fmtDate(job.updatedAt)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
          Top-level error {job.error ? '' : <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(none — this job type reports failures per item, below)</span>}
        </div>
        {job.error ? (
          <pre style={{ margin: 0, padding: 16, fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{job.error}</pre>
        ) : (
          <div style={{ padding: '16px', color: 'var(--muted)', fontSize: 13 }}>No whole-job error recorded.</div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
          Per-item failures {job.failures.length > 0 && `(${job.failures.length})`}
        </div>
        {job.failures.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--muted)', fontSize: 13 }}>No per-item failures recorded.</div>
        ) : (
          <table>
            <thead><tr><th style={{ width: 240 }}>Item</th><th>Full error</th></tr></thead>
            <tbody>
              {job.failures.map((f, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, verticalAlign: 'top' }}>{f.label}</td>
                  <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="panel">
          <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>Payload</div>
          <pre style={{ margin: 0, padding: 16, fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflow: 'auto' }}>
            {JSON.stringify(job.payload ?? {}, null, 2)}
          </pre>
        </div>
        <div className="panel">
          <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>Cursor</div>
          <pre style={{ margin: 0, padding: 16, fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflow: 'auto' }}>
            {JSON.stringify(job.cursor ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}
