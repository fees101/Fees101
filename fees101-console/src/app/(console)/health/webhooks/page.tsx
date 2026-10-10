import Link from 'next/link'
import {
  getWebhookEvents,
  getWebhookEventFacets,
  getSmsWebhookEvents,
  getSmsWebhookFacets,
} from '@/lib/opsQueries'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Webhook delivery — a real search/filter/paginate explorer over the full
// webhook_events table (Paystack/Monnify payment webhooks), plus a thinner
// explorer over sms_webhook_events (SMS/email delivery callbacks). 2026-10-10
// owner feedback: "I need to be able to search filter see the stats see the
// details on each of those webhooks... when schools come with queries I will
// need these dashboards to show things first before I go elsewhere." Mirrors
// the audit log's searchParams + buildQuery + .range() convention. Each
// payment-webhook row links to /health/webhooks/[id] for full raw-payload
// detail — the single most concrete thing asked for.
//
// This used to be an in-page tab; split into its own route 2026-10-10 (second
// pass) — a heavy filterable explorer doesn't belong inside a tab bar.

const fieldStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  color: 'var(--ink)',
  fontFamily: 'var(--font)',
  fontSize: 13,
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

type WebhooksSearchParams = {
  wSchool?: string
  wProvider?: string
  wEventType?: string
  wStatus?: string
  wSearch?: string
  wFrom?: string
  wTo?: string
  wPage?: string
  sSource?: string
  sMatched?: string
  sSearch?: string
  sFrom?: string
  sTo?: string
  sPage?: string
}

function buildQuery(sp: WebhooksSearchParams, overrides: WebhooksSearchParams) {
  const merged: WebhooksSearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

const WEBHOOK_PAGE_SIZE = 50
const SMS_PAGE_SIZE = 50

type PageProps = { searchParams: Promise<WebhooksSearchParams> }

export default async function WebhookDeliveryPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const wPage = Math.max(1, parseInt(sp.wPage || '1', 10) || 1)
  const sPage = Math.max(1, parseInt(sp.sPage || '1', 10) || 1)

  const [webhookFacets, webhookResult, smsFacets, smsResult, schoolsResult] = await Promise.all([
    getWebhookEventFacets(),
    getWebhookEvents({
      schoolId: sp.wSchool, provider: sp.wProvider, eventType: sp.wEventType, status: sp.wStatus,
      search: sp.wSearch, from: sp.wFrom, to: sp.wTo, page: wPage,
    }),
    getSmsWebhookFacets(),
    getSmsWebhookEvents({ source: sp.sSource, matched: sp.sMatched as 'true' | 'false' | undefined, search: sp.sSearch, from: sp.sFrom, to: sp.sTo, page: sPage }),
    createServiceRoleClient().from('schools').select('id, name').order('name'),
  ])
  const schools = schoolsResult.data || []

  const wTotalPages = Math.max(1, Math.ceil(webhookResult.total / WEBHOOK_PAGE_SIZE))
  const sTotalPages = Math.max(1, Math.ceil(smsResult.total / SMS_PAGE_SIZE))

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div className="kicker">Payments & health</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Webhook delivery</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Object.keys(webhookResult.statusCounts).length)}, 1fr)`, gap: 1, background: 'var(--border)', border: '1px solid var(--border)', marginBottom: 20 }}>
        {Object.entries(webhookResult.statusCounts).length === 0 ? (
          <div className="kpi" style={{ background: 'var(--panel)' }}>
            <span className="kicker">Matching events</span>
            <div className="kpi-value">0</div>
          </div>
        ) : (
          Object.entries(webhookResult.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
            <div key={status} className="kpi" style={{ background: 'var(--panel)' }}>
              <span className="kicker">{status}</span>
              <div className="kpi-value">{count}</div>
            </div>
          ))
        )}
      </div>

      <form method="get" className="panel" style={{ display: 'flex', gap: 10, padding: 14, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Search (reference / error)</label>
          <input type="text" name="wSearch" defaultValue={sp.wSearch || ''} placeholder="fam-test-..." style={{ ...fieldStyle, width: 200 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>School</label>
          <select name="wSchool" defaultValue={sp.wSchool || ''} style={fieldStyle}>
            <option value="">All schools</option>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Provider</label>
          <select name="wProvider" defaultValue={sp.wProvider || ''} style={fieldStyle}>
            <option value="">All providers</option>
            {webhookFacets.providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Event type</label>
          <select name="wEventType" defaultValue={sp.wEventType || ''} style={fieldStyle}>
            <option value="">All event types</option>
            {webhookFacets.eventTypes.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Status</label>
          <select name="wStatus" defaultValue={sp.wStatus || ''} style={fieldStyle}>
            <option value="">All statuses</option>
            {webhookFacets.statuses.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>From</label>
          <input type="date" name="wFrom" defaultValue={sp.wFrom ? sp.wFrom.slice(0, 10) : ''} style={fieldStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>To</label>
          <input type="date" name="wTo" defaultValue={sp.wTo ? sp.wTo.slice(0, 10) : ''} style={fieldStyle} />
        </div>
        <button type="submit" className="btn btn-primary">Filter</button>
        {(sp.wSearch || sp.wSchool || sp.wProvider || sp.wEventType || sp.wStatus || sp.wFrom || sp.wTo) && (
          <Link href="/health/webhooks" className="btn btn-ghost">Clear</Link>
        )}
      </form>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
          Payment webhook events — {webhookResult.total} matching
        </div>
        {webhookResult.rows.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No webhook events match this filter.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>School</th><th>Provider</th><th>Event</th><th>Reference</th><th>Status</th><th>Error</th><th>Received</th><th></th></tr></thead>
              <tbody>
                {webhookResult.rows.map(w => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{w.schoolName}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{w.provider}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{w.eventType || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{w.transactionReference || '—'}</td>
                    <td><span className={`tag ${w.status === 'processed' ? 'tag-good' : w.status === 'error' ? 'tag-bad' : 'tag-warn'}`}><span className="dot" />{w.status}</span></td>
                    <td style={{ color: 'var(--muted)' }}>
                      {/* See health/jobs/page.tsx's comment on this same pattern — maxWidth/ellipsis
                          must go on a nested div, not the <td> itself, or a long nowrap error string
                          blows the whole table (and page) out past the viewport instead of truncating. */}
                      <div style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.errorMessage || '—'}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(w.receivedAt)}</td>
                    <td><Link href={`/health/webhooks/${w.id}`} className="btn btn-ghost">Details</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {wTotalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 26, fontSize: 13, color: 'var(--muted)' }}>
          <span>Page {wPage} of {wTotalPages}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {wPage > 1 && <Link href={buildQuery(sp, { wPage: String(wPage - 1) })} className="btn btn-ghost">Previous</Link>}
            {wPage < wTotalPages && <Link href={buildQuery(sp, { wPage: String(wPage + 1) })} className="btn btn-ghost">Next</Link>}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
          SMS/email delivery webhooks — {smsResult.matchedCount} matched, {smsResult.unmatchedCount} unmatched (filtered set)
        </div>
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--faint)', borderBottom: '1px solid var(--border)' }}>
          This table (sms_webhook_events) has no school column at the database level — delivery callbacks are matched back to a message by reference, not tenant-scoped. Filter by source, match status, date, or the provider reference.
        </div>
      </div>

      <form method="get" className="panel" style={{ display: 'flex', gap: 10, padding: 14, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Search (reference)</label>
          <input type="text" name="sSearch" defaultValue={sp.sSearch || ''} placeholder="MN-SMS-..." style={{ ...fieldStyle, width: 180 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Source</label>
          <select name="sSource" defaultValue={sp.sSource || ''} style={fieldStyle}>
            <option value="">All sources</option>
            {smsFacets.sources.map(src => <option key={src} value={src}>{src}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Matched</label>
          <select name="sMatched" defaultValue={sp.sMatched || ''} style={fieldStyle}>
            <option value="">Any</option>
            <option value="true">Matched</option>
            <option value="false">Unmatched</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>From</label>
          <input type="date" name="sFrom" defaultValue={sp.sFrom ? sp.sFrom.slice(0, 10) : ''} style={fieldStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>To</label>
          <input type="date" name="sTo" defaultValue={sp.sTo ? sp.sTo.slice(0, 10) : ''} style={fieldStyle} />
        </div>
        <button type="submit" className="btn btn-primary">Filter</button>
        {(sp.sSearch || sp.sSource || sp.sMatched || sp.sFrom || sp.sTo) && (
          <Link href="/health/webhooks" className="btn btn-ghost">Clear</Link>
        )}
      </form>

      <div className="panel">
        {smsResult.rows.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>No SMS/email delivery webhooks match this filter.</div>
        ) : (
          <table>
            <thead><tr><th>Source</th><th>Module</th><th>Reference</th><th>Delivery status</th><th>Matched</th><th>Received</th></tr></thead>
            <tbody>
              {smsResult.rows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.source}</td>
                  <td>{r.payloadModule || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.reference || '—'}</td>
                  <td>{r.payloadStatus || '—'}</td>
                  <td><span className={`tag ${r.matched ? 'tag-good' : 'tag-warn'}`}><span className="dot" />{r.matched ? 'matched' : 'unmatched'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sTotalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>
          <span>Page {sPage} of {sTotalPages}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {sPage > 1 && <Link href={buildQuery(sp, { sPage: String(sPage - 1) })} className="btn btn-ghost">Previous</Link>}
            {sPage < sTotalPages && <Link href={buildQuery(sp, { sPage: String(sPage + 1) })} className="btn btn-ghost">Next</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
