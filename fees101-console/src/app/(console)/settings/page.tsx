import Link from 'next/link'
import { getPlatformAdmins, getScheduledDeletions, getPendingDeletionCount } from '@/lib/opsQueries'
import Tabs from '@/components/Tabs'

// docs/platform-dashboard-architecture.md §4.8. CRUD for platform admins/roles
// is the "internal users & permissions v2" item (ROADMAP.md: deferred until a
// second internal user exists) — this is a read-only list until then. Billing
// defaults are shown for reference only (they live as code constants in
// fees101-web's platformBilling lib, not DB rows — editing them here would
// mean two sources of truth, so this stays display-only by design).
//
// Platform admins and billing defaults stay unpaginated/unfiltered on purpose
// — there will only ever be a handful of internal admins, and billing
// defaults are a fixed handful of constants. Scheduled deletions is the one
// table here that can grow unbounded over the platform's life (every school
// that ever churns adds a row), so that one gets real server-side pagination
// + a status filter, same shape as /audit.
//
// Environment tab added 2026-10-10: a plain read-only view of which
// integrations are configured and in test vs. live mode — exactly the kind
// of thing the go-live checklist needs ("sandbox -> prod swaps") and that
// was previously only answerable by reading .env files directly. Never
// prints a secret's actual value, only whether it's set and (for Paystack,
// where the key prefix itself is the signal) which mode it's in.

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
}

const DELETIONS_PAGE_SIZE = 20

type SearchParams = { tab?: string; deletionStatus?: string; deletionPage?: string }

function buildQuery(sp: SearchParams, overrides: SearchParams) {
  const merged: SearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

const DELETION_STATUS_OPTIONS = ['scheduled', 'cancelled', 'completed']

type PageProps = { searchParams: Promise<SearchParams> }

export default async function SettingsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const deletionPage = Math.max(1, parseInt(sp.deletionPage || '1', 10) || 1)

  const [admins, deletionsResult, pendingDeletionCount] = await Promise.all([
    getPlatformAdmins(),
    getScheduledDeletions({ status: sp.deletionStatus, page: deletionPage }),
    getPendingDeletionCount(),
  ])
  const { rows: deletions, total: deletionsTotal } = deletionsResult
  const deletionTotalPages = Math.max(1, Math.ceil(deletionsTotal / DELETIONS_PAGE_SIZE))

  const paystackKey = process.env.PAYSTACK_SECRET_KEY || ''
  const paystackMode = paystackKey.startsWith('sk_live') ? 'Live' : paystackKey.startsWith('sk_test') ? 'Test' : null
  const envChecks: { label: string; ok: boolean; status: string; detail: string; mono?: boolean }[] = [
    {
      label: 'Paystack secret key',
      ok: !!paystackMode,
      status: paystackMode ? `${paystackMode} mode` : 'Not configured',
      detail: paystackMode === 'Live' ? 'Processing real transactions.' : paystackMode === 'Test' ? 'Sandbox key — no real money moves.' : 'PAYSTACK_SECRET_KEY is unset.',
    },
    {
      label: 'Supabase project',
      ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      status: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Configured' : 'Not configured',
      detail: process.env.NEXT_PUBLIC_SUPABASE_URL || 'NEXT_PUBLIC_SUPABASE_URL is unset.',
      mono: true,
    },
    {
      label: 'Supabase anon key',
      ok: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      status: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Configured' : 'Not configured',
      detail: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Set (value hidden).' : 'NEXT_PUBLIC_SUPABASE_ANON_KEY is unset.',
    },
    {
      label: 'Supabase service role key',
      ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      status: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Configured' : 'Not configured',
      detail: process.env.SUPABASE_SERVICE_ROLE_KEY
        ? 'Set (value hidden) — every cross-tenant read in this console depends on this.'
        : 'SUPABASE_SERVICE_ROLE_KEY is unset — the whole console would fail to read any data.',
    },
    {
      label: 'Billing cron secret',
      ok: !!process.env.BILLING_CRON_SECRET,
      status: process.env.BILLING_CRON_SECRET ? 'Configured' : 'Not configured',
      detail: process.env.BILLING_CRON_SECRET ? 'Set (value hidden) — gates the daily billing-status cron.' : 'BILLING_CRON_SECRET is unset — the billing cron endpoint is unprotected or disabled.',
    },
    {
      label: 'General cron secret',
      ok: !!process.env.CRON_SECRET,
      status: process.env.CRON_SECRET ? 'Configured' : 'Not configured',
      detail: process.env.CRON_SECRET ? 'Set (value hidden).' : 'CRON_SECRET is unset.',
    },
    {
      label: 'Console app URL',
      ok: !!process.env.NEXT_PUBLIC_APP_URL,
      status: process.env.NEXT_PUBLIC_APP_URL ? 'Configured' : 'Not configured',
      detail: process.env.NEXT_PUBLIC_APP_URL || 'NEXT_PUBLIC_APP_URL is unset.',
      mono: true,
    },
    {
      label: 'School app URL',
      ok: !!process.env.SCHOOL_APP_URL,
      status: process.env.SCHOOL_APP_URL ? 'Configured' : 'Not configured',
      detail: process.env.SCHOOL_APP_URL || 'SCHOOL_APP_URL is unset — links out to a school’s own app (e.g. owner password reset) would break.',
      mono: true,
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div className="kicker">Settings</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Platform settings</h1>
      </div>

      <Tabs
        defaultKey={sp.tab || 'admins'}
        tabs={[
          {
            key: 'admins',
            label: 'Platform admins',
            count: admins.length,
            content: (
              <div className="panel">
                <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>Platform admins</div>
                <table>
                  <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th></tr></thead>
                  <tbody>
                    {admins.map(a => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{a.name}</td>
                        <td>{a.email}</td>
                        <td><span className="tag tag-accent">{a.role}</span></td>
                        <td>{fmtDate(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '12px 16px', color: 'var(--faint)', fontSize: 12 }}>
                  Added via direct SQL insert into platform_admins — no self-serve invite flow yet (v2 item, see ROADMAP.md &ldquo;internal users &amp; permissions v2&rdquo;).
                </div>
              </div>
            ),
          },
          {
            key: 'billing',
            label: 'Billing defaults',
            content: (
              <div className="panel">
                <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>Billing defaults (reference)</div>
                <table>
                  <tbody>
                    <tr><td style={{ fontWeight: 600, width: 260 }}>Price per student / month</td><td>₦500</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Free period</td><td>65 days from onboarding date</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Billed cycle length</td><td>300 days (recurring, anchored to onboarding)</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>One-time setup fee</td><td>₦10,000</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>DVA fallback transfer fee</td><td>₦300 flat per transfer</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Dunning ladder</td><td>active → payment_due → grace → suspended</td></tr>
                  </tbody>
                </table>
                <div style={{ padding: '12px 16px', color: 'var(--faint)', fontSize: 12 }}>
                  These live as code constants in fees101-web (the single source of truth for the billing computation) — shown here for reference only, not editable from the console.
                </div>
              </div>
            ),
          },
          {
            key: 'deletions',
            label: 'Scheduled deletions',
            count: pendingDeletionCount,
            content: (
              <div className="panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '2px solid var(--rule)' }}>
                  <span style={{ fontWeight: 800 }}>
                    Scheduled school deletions {pendingDeletionCount > 0 && `(${pendingDeletionCount} pending)`}
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>{deletionsTotal} matching {deletionsTotal === 1 ? 'request' : 'requests'}</span>
                </div>

                <form method="get" style={{ display: 'flex', gap: 10, padding: '12px 16px', flexWrap: 'wrap', alignItems: 'flex-end', borderBottom: '2px solid var(--rule)' }}>
                  <input type="hidden" name="tab" value="deletions" />
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Status</label>
                    <select name="deletionStatus" defaultValue={sp.deletionStatus || ''} className="field">
                      <option value="">All statuses</option>
                      {DELETION_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <button type="submit" className="btn btn-primary">Filter</button>
                  {sp.deletionStatus && <Link href="/settings?tab=deletions" className="btn btn-ghost">Clear</Link>}
                </form>

                {deletions.length === 0 ? (
                  <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>
                    {deletionsTotal === 0 && !sp.deletionStatus ? 'No school has ever requested deletion.' : 'No deletion requests match this filter.'}
                  </div>
                ) : (
                  <table>
                    <thead><tr><th>School</th><th>Status</th><th>Requested by</th><th>Scheduled for</th><th>Financial purge</th><th>Archived rows</th></tr></thead>
                    <tbody>
                      {deletions.map(d => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 600 }}>{d.schoolName}</td>
                          <td><span className={`tag ${d.status === 'scheduled' ? 'tag-warn' : d.status === 'completed' ? 'tag-bad' : 'tag'}`}><span className="dot" />{d.status}</span></td>
                          <td>{d.requestedByName} <span style={{ color: 'var(--faint)' }}>({d.requestedByEmail})</span></td>
                          <td>{fmtDate(d.scheduledFor)}</td>
                          <td>{fmtDate(d.financialPurgeAt)}</td>
                          <td>{d.archivedRecordCount ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {deletionTotalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>
                    <span>Page {deletionPage} of {deletionTotalPages}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {deletionPage > 1 && <Link href={buildQuery(sp, { tab: 'deletions', deletionPage: String(deletionPage - 1) })} className="btn btn-ghost">Previous</Link>}
                      {deletionPage < deletionTotalPages && <Link href={buildQuery(sp, { tab: 'deletions', deletionPage: String(deletionPage + 1) })} className="btn btn-ghost">Next</Link>}
                    </div>
                  </div>
                )}

                <div style={{ padding: '12px 16px', color: 'var(--faint)', fontSize: 12 }}>
                  Read-only. Cancelling a pending deletion is still a secret-protected manual DB update (ROADMAP.md) &mdash; a console cancel action is a deliberate next decision, not built here, since it is destructive-adjacent.
                </div>
              </div>
            ),
          },
          {
            key: 'environment',
            label: 'Environment',
            content: (
              <div className="panel">
                <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
                  Environment &amp; configuration
                </div>
                <table>
                  <thead><tr><th>Integration</th><th>Status</th><th>Detail</th></tr></thead>
                  <tbody>
                    {envChecks.map(c => (
                      <tr key={c.label}>
                        <td style={{ fontWeight: 600 }}>{c.label}</td>
                        <td><span className={`tag ${c.ok ? 'tag-good' : 'tag-bad'}`}><span className="dot" />{c.status}</span></td>
                        <td style={{ color: 'var(--muted)', fontFamily: c.mono ? 'monospace' : undefined, fontSize: c.mono ? 12 : undefined }}>{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '12px 16px', color: 'var(--faint)', fontSize: 12 }}>
                  Read directly from this deployment&rsquo;s environment variables at request time. Secret values are never shown — only whether a key is set, and for Paystack, the mode its key prefix declares. See the go-live checklist for which of these need a sandbox&rarr;production swap before launch.
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
