import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdmin } from '@/lib/auth'
import { getAllSchoolsBillingOverview } from '@/lib/accrual'

function naira(n: number) {
  return '₦' + (Math.round(n * 100) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--good)',
  payment_due: 'var(--warn)',
  grace: 'var(--warn)',
  suspended: 'var(--bad)',
  cancelled: 'var(--muted)',
}

export default async function BillingPage() {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  const rows = await getAllSchoolsBillingOverview()
  const totalMonthToDate = rows.reduce((sum, r) => sum + r.monthToDateAccrued, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="kicker">Billing</div>
          <h1 style={{ fontSize: 24, marginTop: 6 }}>Billing</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Per-student accrual month to date, across every school. See a school&rsquo;s own page for charge history and the legacy flat-fee path.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>Accrued this month, all schools</p>
          <p style={{ fontSize: 20, fontWeight: 700 }}>{naira(totalMonthToDate)}</p>
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>Active students</th>
              <th>Price/student/month</th>
              <th>Billing path</th>
              <th>Accrued this month</th>
              <th>Billing status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.schoolId}>
                <td>
                  <Link href={`/schools/${r.schoolId}`} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }}>
                    {r.schoolName}
                  </Link>
                </td>
                <td>{r.activeStudentCount}</td>
                <td>{naira(r.pricePerStudentMonth)}</td>
                <td>{r.onAccrualPath ? 'Per-student accrual' : <span style={{ color: 'var(--muted)' }}>Legacy flat fee</span>}</td>
                <td>{r.onAccrualPath ? naira(r.monthToDateAccrued) : <span style={{ color: 'var(--muted)' }}>{'—'}</span>}</td>
                <td>
                  <span style={{ color: STATUS_COLOR[r.billingStatus] || 'var(--muted)', fontWeight: 600, textTransform: 'capitalize' }}>
                    {r.billingStatus.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>No schools yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
