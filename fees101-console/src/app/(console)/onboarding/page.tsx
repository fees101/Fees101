import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdmin } from '@/lib/auth'
import { getRecentAccessRequests, getAccessRequestStatuses } from '@/lib/opsQueries'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import OnboardingForm from './OnboardingForm'
import LeadStatusForm from './LeadStatusForm'

// Onboarding — create a new school tenant, and the marketing-site signup
// pipeline it draws from. Full pass 2026-10-10: the leads list was
// previously read-only forever (view only, no way to track outreach
// progress) and the create-school form required re-typing a lead's details
// by hand even when one was sitting right below it. Both closed here:
// LeadStatusForm lets a lead move new → contacted → converted/declined
// in place; each lead row's "Onboard this lead" link prefills the form via
// query params instead of a blank one. Side-by-side layout (form + pipeline
// snapshot) instead of a lone narrow form with dead space to its right.

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_TAG: Record<string, string> = {
  new: 'tag-warn', contacted: 'tag-accent', converted: 'tag-good', declined: 'tag-bad',
}

type SearchParams = { status?: string; page?: string; leadSchool?: string; leadContact?: string; leadEmail?: string }

function buildQuery(sp: SearchParams, overrides: SearchParams) {
  const merged: SearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

const PAGE_SIZE = 20

type PageProps = { searchParams: Promise<SearchParams> }

export default async function OnboardingPage({ searchParams }: PageProps) {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)

  const [{ rows: leads, total }, statusOptions, { count: newCount }] = await Promise.all([
    getRecentAccessRequests({ status: sp.status, page }),
    getAccessRequestStatuses(),
    createServiceRoleClient().from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  ])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div id="top">
      <div className="kicker">Onboarding</div>
      <h1 style={{ fontSize: 24, marginTop: 6, marginBottom: 18 }}>Onboard a school</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28, alignItems: 'start' }}>
        <div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, maxWidth: 480 }}>
            Creates the school and the owner&rsquo;s login. Everything else — academic structure, fee items, payment provider, staff — the school sets up itself once they&rsquo;re in.
          </p>
          <OnboardingForm
            key={`${sp.leadSchool || ''}|${sp.leadContact || ''}|${sp.leadEmail || ''}`}
            initialSchoolName={sp.leadSchool || ''}
            initialOwnerName={sp.leadContact || ''}
            initialOwnerEmail={sp.leadEmail || ''}
          />
        </div>

        <div>
          <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 0 }}>
            <div className="stat">
              <span className="kicker">Signup requests, all time</span>
              <div className="stat-value">{total}</div>
              <div className="stat-sub">from the marketing site</div>
            </div>
            <div className="stat">
              <span className="kicker">New leads</span>
              <div className="stat-value">{newCount || 0}</div>
              <div className="stat-sub">not yet contacted</div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 1, padding: 16 }}>
            <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              Leads flow in from fees101.com&rsquo;s signup form with no automated reply yet — the pipeline on the right is the only place they&rsquo;re visible before this pass. Use &ldquo;Onboard this lead&rdquo; on a row to pre-fill the form on the left with their details, or advance/decline a lead in place once you&rsquo;ve followed up.
            </p>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h2>Recent signup requests — {total} matching</h2>
      </div>
      <div className="panel">
        <form method="get" style={{ display: 'flex', gap: 10, padding: '12px 16px', flexWrap: 'wrap', alignItems: 'flex-end', borderBottom: '2px solid var(--rule)' }}>
          <div>
            <label className="field-label">Status</label>
            <select name="status" defaultValue={sp.status || ''} className="field">
              <option value="">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary">Filter</button>
          {sp.status && <Link href="/onboarding" className="btn btn-ghost">Clear</Link>}
        </form>

        {leads.length === 0 ? (
          <div style={{ padding: '22px 16px', color: 'var(--muted)', fontSize: 13 }}>
            {total === 0 && !sp.status ? 'No signup requests from the marketing site yet.' : 'No signup requests match this filter.'}
          </div>
        ) : (
          <table>
            <thead><tr><th>School</th><th>Contact</th><th>Students</th><th>Status</th><th>Received</th><th></th><th></th></tr></thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>{l.schoolName}</td>
                  <td>{l.contactName} <span style={{ color: 'var(--faint)' }}>({l.email})</span></td>
                  <td>{l.studentCount ?? '—'}</td>
                  <td><span className={`tag ${STATUS_TAG[l.status] || 'tag'}`}><span className="dot" />{l.status}</span></td>
                  <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDate(l.createdAt)}</td>
                  <td>
                    <Link
                      href={`/onboarding?leadSchool=${encodeURIComponent(l.schoolName)}&leadContact=${encodeURIComponent(l.contactName)}&leadEmail=${encodeURIComponent(l.email)}#top`}
                      className="btn btn-ghost btn-sm"
                    >
                      Onboard this lead
                    </Link>
                  </td>
                  <td><LeadStatusForm id={l.id} status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>
            <span>Page {page} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {page > 1 && <Link href={buildQuery(sp, { page: String(page - 1) })} className="btn btn-ghost">Previous</Link>}
              {page < totalPages && <Link href={buildQuery(sp, { page: String(page + 1) })} className="btn btn-ghost">Next</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
