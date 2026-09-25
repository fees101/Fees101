import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdmin } from '@/lib/auth'
import { getSchoolsOverview, getAllSchoolsCostToServe } from '@/lib/queries'

function naira(n: number) {
  return '₦' + Math.round(n).toLocaleString('en-NG')
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--good)',
  payment_due: 'var(--warn)',
  grace: 'var(--warn)',
  suspended: 'var(--bad)',
  cancelled: 'var(--muted)',
}

export default async function SchoolsPage() {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  const [schools, costToServe] = await Promise.all([getSchoolsOverview(), getAllSchoolsCostToServe()])

  const totalMessagingCost = Array.from(costToServe.values()).reduce((sum, u) => sum + u.totalCost, 0)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Schools</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Signed in as {admin.name}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>Messaging cost across all schools</p>
          <p style={{ fontSize: 20, fontWeight: 700 }}>{naira(totalMessagingCost)}</p>
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>Students</th>
              <th>Terms/yr</th>
              <th>Annual price</th>
              <th>Billing status</th>
              <th>Messaging cost</th>
              <th>Row count (storage proxy)</th>
            </tr>
          </thead>
          <tbody>
            {schools.map(s => {
              const usage = costToServe.get(s.id)
              return (
                <tr key={s.id}>
                  <td>
                    <Link href={`/schools/${s.id}`} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }}>
                      {s.name}
                    </Link>
                  </td>
                  <td>{s.studentCount}</td>
                  <td>{s.termsPerYear}</td>
                  <td>{s.annualPrice > 0 ? naira(s.annualPrice) : <span style={{ color: 'var(--muted)' }}>Not set</span>}</td>
                  <td>
                    <span style={{ color: STATUS_COLOR[s.billingStatus] || 'var(--muted)', fontWeight: 600, textTransform: 'capitalize' }}>
                      {s.billingStatus.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{usage ? naira(usage.totalCost) : naira(0)}</td>
                  <td>{usage?.rowCountProxy ?? '—'}</td>
                </tr>
              )
            })}
            {schools.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>No schools yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
