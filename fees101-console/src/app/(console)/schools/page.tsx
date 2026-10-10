import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdmin } from '@/lib/auth'
import { getSchoolsListPage, getSchoolsOverview } from '@/lib/queries'

// Schools directory — docs/platform-dashboard-architecture.md §4.2: "searchable,
// filterable (status, billing state, provider, size), paginated table." Full
// pass 2026-10-10: search + pagination already existed; billing-status and
// provider filters plus sort were real gaps against that spec, closed here
// (see getSchoolsListPage in queries.ts for how the filter/sort works without
// an N+1 or an unbounded row scan). Also removed this page's own
// `maxWidth: 1180` centered wrapper — it was fighting the shell's own
// `.content` width, which is exactly the "why's there so much blank space"
// pattern found across this whole console; width belongs to the shell.
// Added a summary stat strip (reusing the same getSchoolsOverview() aggregate
// Home already computes) so the directory isn't just a bare table — size,
// health and provider coverage are visible before you even search.

function naira(n: number) {
  return '₦' + Math.round(n).toLocaleString('en-NG')
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_TAG: Record<string, string> = {
  active: 'tag-good', payment_due: 'tag-warn', grace: 'tag-warn',
  suspended: 'tag-bad', cancelled: 'tag',
}

const MANDATE_COLOR: Record<string, string> = {
  'Mandate (active)': 'var(--good-text)',
  'Mandate deactivated': 'var(--bad-text)',
  'Not connected': 'var(--muted)',
}

const PROVIDER_LABEL: Record<string, string> = {
  paystack: 'Paystack',
  monnify: 'Monnify',
}

const STATUS_OPTIONS = ['active', 'payment_due', 'grace', 'suspended', 'cancelled']
const PROVIDER_OPTIONS = ['paystack', 'monnify']
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'students_desc', label: 'Most students' },
]

const PER_PAGE = 20

type SchoolsSearchParams = { q?: string; page?: string; status?: string; provider?: string; sort?: string }

function buildQuery(sp: SchoolsSearchParams, overrides: SchoolsSearchParams) {
  const merged: SchoolsSearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

type PageProps = {
  searchParams: Promise<SchoolsSearchParams>
}

export default async function SchoolsPage({ searchParams }: PageProps) {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const q = sp.q || ''
  const sort = (sp.sort || 'newest') as 'newest' | 'oldest' | 'name' | 'students_desc'

  const [{ rows: schools, total }, allSchools] = await Promise.all([
    getSchoolsListPage({ page, perPage: PER_PAGE, q, billingStatus: sp.status, provider: sp.provider, sort }),
    getSchoolsOverview(),
  ])
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const totalStudents = allSchools.reduce((sum, s) => sum + s.studentCount, 0)
  const needsAttentionCount = allSchools.filter(s => s.billingStatus !== 'active').length
  const hasFilters = !!(q || sp.status || sp.provider)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="kicker">Tenants</div>
          <h1 style={{ fontSize: 24, marginTop: 6 }}>Schools</h1>
        </div>
        <Link href="/onboarding" className="btn btn-primary">Onboard new school</Link>
      </div>

      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat">
          <span className="kicker">Total schools</span>
          <div className="stat-value">{allSchools.length}</div>
          <div className="stat-sub">{total} matching current filter</div>
        </div>
        <div className="stat">
          <span className="kicker">Active students</span>
          <div className="stat-value">{totalStudents.toLocaleString('en-NG')}</div>
          <div className="stat-sub">across every school</div>
        </div>
        <div className="stat">
          <span className="kicker">Off &ldquo;active&rdquo; billing</span>
          <div className="stat-value">{needsAttentionCount}</div>
          <div className="stat-sub">payment_due, grace or suspended</div>
        </div>
        <div className="stat">
          <span className="kicker">Signed in as</span>
          <div className="stat-value" style={{ fontSize: 15 }}>{admin.name}</div>
          <div className="stat-sub">{admin.role}</div>
        </div>
      </div>

      <form method="get" className="panel" style={{ display: 'flex', gap: 10, padding: 14, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label className="field-label">Search</label>
          <input type="text" name="q" defaultValue={q} placeholder="School name…" className="field" style={{ width: 220 }} />
        </div>
        <div>
          <label className="field-label">Billing status</label>
          <select name="status" defaultValue={sp.status || ''} className="field">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Provider</label>
          <select name="provider" defaultValue={sp.provider || ''} className="field">
            <option value="">All providers</option>
            {PROVIDER_OPTIONS.map(p => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Sort</label>
          <select name="sort" defaultValue={sort} className="field">
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">Apply</button>
        {hasFilters && <Link href="/schools" className="btn btn-ghost">Clear</Link>}
      </form>

      <div className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Students</th>
                <th>Billing status</th>
                <th>Provider</th>
                <th>Billing model</th>
                <th>Mandate</th>
                <th>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {schools.map(s => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/schools/${s.id}`} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }}>
                      {s.name}
                    </Link>
                  </td>
                  <td>{s.studentCount.toLocaleString('en-NG')}</td>
                  <td><span className={`tag ${STATUS_TAG[s.billingStatus] || 'tag'}`}><span className="dot" />{s.billingStatus.replace('_', ' ')}</span></td>
                  <td>
                    {s.paymentProvider
                      ? (PROVIDER_LABEL[s.paymentProvider] || s.paymentProvider)
                      : <span style={{ color: 'var(--muted)' }}>Unconfigured</span>}
                  </td>
                  <td>
                    {s.onAccrualPath
                      ? `${naira(s.pricePerStudentMonth)}/student/mo`
                      : <span style={{ color: 'var(--muted)' }}>Not yet billing</span>}
                  </td>
                  <td>
                    <span style={{ color: MANDATE_COLOR[s.mandateRail] || 'var(--warn-text)', fontWeight: 600 }}>
                      {s.mandateRail}
                    </span>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{fmtDate(s.createdAt)}</td>
                </tr>
              ))}
              {schools.length === 0 && (
                <tr><td colSpan={7} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
                  {hasFilters ? 'No schools match this filter.' : 'No schools yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
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
