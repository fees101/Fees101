import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getPlatformAdmin } from '@/lib/auth'
import { getSchoolDetail, getSchoolUsage, getSchoolCharges, getSchoolAuditLog } from '@/lib/queries'
import Tabs from '@/components/Tabs'
import BillingPanel from './BillingPanel'
import AccrualPanel from './AccrualPanel'
import CollectionPanel from './CollectionPanel'
import SetupChecklistPanel from './SetupChecklistPanel'
import OwnerAccessPanel from './OwnerAccessPanel'
import ImpersonatePanel from './ImpersonatePanel'
import MandateBillingPanel from './MandateBillingPanel'
import ManualPaymentEntryPanel from './ManualPaymentEntryPanel'
import DvaFallbackPanel from './DvaFallbackPanel'

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
const PROVIDER_LABEL: Record<string, string> = { paystack: 'Paystack', monnify: 'Monnify' }

type SchoolSearchParams = { tab?: string; chargesPage?: string; auditPage?: string }

function buildQuery(sp: SchoolSearchParams, overrides: SchoolSearchParams) {
  const merged: SchoolSearchParams = { ...sp, ...overrides }
  const params = new URLSearchParams()
  Object.entries(merged).forEach(([k, v]) => { if (v) params.set(k, v) })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<SchoolSearchParams> }

export default async function SchoolDetailPage({ params, searchParams }: PageProps) {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  const { id } = await params
  const sp = await searchParams
  const chargesPage = Math.max(1, parseInt(sp.chargesPage || '1', 10) || 1)
  const auditPage = Math.max(1, parseInt(sp.auditPage || '1', 10) || 1)

  const [school, usage, chargesResult, auditResult] = await Promise.all([
    getSchoolDetail(id),
    getSchoolUsage(id),
    getSchoolCharges(id, chargesPage),
    getSchoolAuditLog(id, auditPage),
  ])
  if (!school) notFound()

  const { rows: charges, total: chargesTotal } = chargesResult
  const chargesTotalPages = Math.max(1, Math.ceil(chargesTotal / 20))
  const { rows: auditLog, total: auditTotal } = auditResult
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / 20))

  return (
    <div>
      <Link href="/schools" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>&larr; All schools</Link>

      {/* Identity header — visible regardless of which tab is open. Added
          2026-10-10: previously a support call needed a tab click to answer
          "when did they sign up, how many students, what provider." Also
          cross-links this school's own slice of the cross-tenant explorers
          (audit/webhooks/money) so a query about THIS school never needs a
          trip through the global page first — the "single pane of glass"
          docs/platform-dashboard-architecture.md §4.2 asks for. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, margin: '10px 0 18px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 24 }}>{school.name}</h1>
            <span className={`tag ${STATUS_TAG[school.billing.billingStatus] || 'tag'}`}><span className="dot" />{school.billing.billingStatus.replace('_', ' ')}</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 6 }}>
            {school.activeStudentCount} active student{school.activeStudentCount === 1 ? '' : 's'} · {school.paymentProvider ? (PROVIDER_LABEL[school.paymentProvider] || school.paymentProvider) : 'no provider configured'} · {school.termsPerYear} terms/year · signed up {fmtDate(school.createdAt)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href={`/health/jobs?school=${school.id}`} className="btn btn-ghost btn-sm">Jobs</Link>
          <Link href={`/health/webhooks?wSchool=${school.id}`} className="btn btn-ghost btn-sm">Webhooks</Link>
          <Link href={`/money?refundsSchool=${school.id}&manualSchool=${school.id}&discountsSchool=${school.id}`} className="btn btn-ghost btn-sm">Money activity</Link>
          <Link href={`/audit?school=${school.id}`} className="btn btn-ghost btn-sm">Audit trail</Link>
        </div>
      </div>

      <Tabs
        defaultKey={sp.tab || 'setup'}
        tabs={[
          {
            key: 'setup',
            label: 'Setup & access',
            content: (
              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 20, alignItems: 'start' }}>
                <SetupChecklistPanel schoolId={school.id} />
                <div>
                  <OwnerAccessPanel schoolId={school.id} />
                  <ImpersonatePanel schoolId={school.id} />
                </div>
              </div>
            ),
          },
          {
            key: 'billing',
            label: 'Billing & collection',
            content: (
              <>
                <div style={{ marginBottom: 24 }}>
                  <MandateBillingPanel schoolId={school.id} />
                </div>

                <div style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <ManualPaymentEntryPanel
                    schoolId={school.id}
                    enabled={school.manualPaymentEntry.enabled}
                    enabledAt={school.manualPaymentEntry.enabledAt}
                    enabledById={school.manualPaymentEntry.enabledById}
                    enabledByName={school.manualPaymentEntry.enabledByName}
                    liabilityVersion={school.manualPaymentEntry.liabilityVersion}
                    liabilityAcceptedAt={school.manualPaymentEntry.liabilityAcceptedAt}
                  />
                  <DvaFallbackPanel
                    schoolId={school.id}
                    enabled={school.dvaFallback.enabled}
                    enabledAt={school.dvaFallback.enabledAt}
                    enabledById={school.dvaFallback.enabledById}
                    enabledByName={school.dvaFallback.enabledByName}
                    billingMethod={school.dvaFallback.billingMethod}
                    mandateStatus={school.dvaFallback.mandateStatus}
                  />
                </div>

                {/* New billing model (daily pro-rata + Fees101 DVA collection) — the panels
                    the accrual + collection tracks built, re-homed here per the IA. */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <AccrualPanel schoolId={school.id} />
                  <CollectionPanel schoolId={school.id} />
                </div>
              </>
            ),
          },
          {
            key: 'legacy',
            label: 'Legacy (card model)',
            content: (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}>
                  <span className="kicker">Legacy (card model — being replaced)</span>
                </div>

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
                    <p style={{ fontSize: 13, marginBottom: 4 }}>Status: <strong style={{ textTransform: 'capitalize' }}>{school.billing.billingStatus.replace('_', ' ')}</strong></p>
                    <p style={{ fontSize: 13 }}>Saved card: {school.billing.hasSavedCard ? 'Yes' : 'No'}</p>
                  </div>
                </div>

                <BillingPanel schoolId={school.id} billing={school.billing} />

                <div className="panel" style={{ padding: 20, marginTop: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>Charge history</p>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>{chargesTotal} total</p>
                  </div>
                  <table>
                    <thead><tr><th>When</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead>
                    <tbody>
                      {charges.map(c => (
                        <tr key={c.id}>
                          <td>{new Date(c.createdAt).toLocaleString('en-GB')}</td>
                          <td>{naira(c.amount)}</td>
                          <td style={{ textTransform: 'capitalize' }}>{c.status}</td>
                          <td style={{ color: 'var(--bad)' }}>{c.failureReason || ''}</td>
                        </tr>
                      ))}
                      {charges.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)', textAlign: 'center' }}>No charges yet.</td></tr>}
                    </tbody>
                  </table>
                  {chargesTotalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
                      <span>Page {chargesPage} of {chargesTotalPages}</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {chargesPage > 1 && <Link href={buildQuery(sp, { tab: 'legacy', chargesPage: String(chargesPage - 1) })} className="btn btn-ghost">Previous</Link>}
                        {chargesPage < chargesTotalPages && <Link href={buildQuery(sp, { tab: 'legacy', chargesPage: String(chargesPage + 1) })} className="btn btn-ghost">Next</Link>}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ),
          },
          {
            key: 'activity',
            label: 'Activity',
            count: auditTotal,
            content: (
              <div className="panel" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>Platform audit log</p>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>{auditTotal} total</p>
                </div>
                <table>
                  <thead><tr><th>When</th><th>Actor</th><th>Action</th></tr></thead>
                  <tbody>
                    {auditLog.map(a => (
                      <tr key={a.id}>
                        <td>{new Date(a.createdAt).toLocaleString('en-GB')}</td>
                        <td>{a.actorName}</td>
                        <td>{a.summary}</td>
                      </tr>
                    ))}
                    {auditLog.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--muted)', textAlign: 'center' }}>No activity yet.</td></tr>}
                  </tbody>
                </table>
                {auditTotalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
                    <span>Page {auditPage} of {auditTotalPages}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {auditPage > 1 && <Link href={buildQuery(sp, { tab: 'activity', auditPage: String(auditPage - 1) })} className="btn btn-ghost">Previous</Link>}
                      {auditPage < auditTotalPages && <Link href={buildQuery(sp, { tab: 'activity', auditPage: String(auditPage + 1) })} className="btn btn-ghost">Next</Link>}
                    </div>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
