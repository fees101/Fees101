import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getWebhookEventById } from '@/lib/opsQueries'

// Full detail for one payment-provider webhook event. The single most
// concrete thing the owner asked for (2026-10-10): "key details on each one"
// — raw payload, error, timestamps, which school, and a link to that
// school's own page — so a support call never needs a trip into Supabase.

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default async function WebhookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const w = await getWebhookEventById(id)
  if (!w) notFound()

  return (
    <div>
      <Link href="/health/webhooks" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>&larr; Webhook events</Link>

      <div style={{ margin: '12px 0 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22 }}>{w.provider} · {w.eventType || 'unknown event'}</h1>
        <span className={`tag ${w.status === 'processed' ? 'tag-good' : w.status === 'error' ? 'tag-bad' : 'tag-warn'}`}>
          <span className="dot" />{w.status}
        </span>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>Event details</div>
        <table>
          <tbody>
            <tr><td style={{ fontWeight: 600, width: 180 }}>School</td><td><Link href={`/schools/${w.schoolId}`}>{w.schoolName}</Link></td></tr>
            <tr><td style={{ fontWeight: 600 }}>Event ID</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{w.id}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>Transaction reference</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{w.transactionReference || '—'}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>Related payment IDs</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{w.relatedPaymentIds && w.relatedPaymentIds.length > 0 ? w.relatedPaymentIds.join(', ') : '—'}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>Received</td><td>{fmtDate(w.receivedAt)}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>Processed</td><td>{fmtDate(w.processedAt)}</td></tr>
            <tr><td style={{ fontWeight: 600 }}>Signature header</td><td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all' }}>{w.signatureHeader || '—'}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
          Error {w.errorMessage ? '' : <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(none)</span>}
        </div>
        {w.errorMessage ? (
          <pre style={{ margin: 0, padding: 16, fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{w.errorMessage}</pre>
        ) : (
          <div style={{ padding: '16px', color: 'var(--muted)', fontSize: 13 }}>No error recorded on this event.</div>
        )}
      </div>

      <div className="panel">
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>Raw payload</div>
        <pre style={{ margin: 0, padding: 16, fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 600, overflow: 'auto' }}>
          {JSON.stringify(w.rawPayload, null, 2)}
        </pre>
      </div>
    </div>
  )
}
