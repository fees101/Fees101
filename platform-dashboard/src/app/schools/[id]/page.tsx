import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdmin } from '@/lib/auth'
import { getSchoolDetail, getSchoolUsage } from '@/lib/queries'
import { getPerTermAmount } from '@/lib/billing'
import BillingPanel from './BillingPanel'

function naira(n: number) {
  return '₦' + Math.round(n).toLocaleString('en-NG')
}

export default async function SchoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  const { id } = await params
  const [school, usage] = await Promise.all([getSchoolDetail(id), getSchoolUsage(id)])
  if (!school) notFound()

  const perTerm = getPerTermAmount(school.billing.annualPrice, school.termsPerYear)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px' }}>
      <Link href="/schools" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>&larr; All schools</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '8px 0 24px' }}>{school.name}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="panel" style={{ padding: 20 }}>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Usage & cost-to-serve</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>SMS: {usage.smsCount} sent · {naira(usage.smsCost)}</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>Email: {usage.emailCount} sent · {naira(usage.emailCost)}</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>Total messaging cost: <strong>{naira(usage.totalCost)}</strong></p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Row count (storage proxy, no byte-level accounting exists yet): {usage.rowCountProxy}</p>
        </div>

        <div className="panel" style={{ padding: 20 }}>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Billing</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>Terms per year: {school.termsPerYear}</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>Annual price: {school.billing.annualPrice > 0 ? naira(school.billing.annualPrice) : '—'}</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>Per term: {perTerm > 0 ? naira(perTerm) : '—'}</p>
          <p style={{ fontSize: 13, marginBottom: 4 }}>Status: <strong style={{ textTransform: 'capitalize' }}>{school.billing.billingStatus.replace('_', ' ')}</strong></p>
          <p style={{ fontSize: 13 }}>Saved card: {school.billing.hasSavedCard ? 'Yes' : 'No'}</p>
        </div>
      </div>

      <BillingPanel schoolId={school.id} billing={school.billing} />

      <div className="panel" style={{ padding: 20, marginTop: 24 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Charge history</p>
        <table>
          <thead><tr><th>When</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            {school.charges.map(c => (
              <tr key={c.id}>
                <td>{new Date(c.createdAt).toLocaleString('en-GB')}</td>
                <td>{naira(c.amount)}</td>
                <td style={{ textTransform: 'capitalize' }}>{c.status}</td>
                <td style={{ color: 'var(--bad)' }}>{c.failureReason || ''}</td>
              </tr>
            ))}
            {school.charges.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)', textAlign: 'center' }}>No charges yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ padding: 20, marginTop: 24 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Platform audit log</p>
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th></tr></thead>
          <tbody>
            {school.auditLog.map(a => (
              <tr key={a.id}>
                <td>{new Date(a.createdAt).toLocaleString('en-GB')}</td>
                <td>{a.actorName}</td>
                <td>{a.summary}</td>
              </tr>
            ))}
            {school.auditLog.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--muted)', textAlign: 'center' }}>No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
