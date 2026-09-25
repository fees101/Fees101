import { redirect } from 'next/navigation'
import { getAnalyticsBundle, redactAnalyticsBundle } from '@/lib/queries/analytics'
import PaymentsDashboard from '@/components/payments/PaymentsDashboard'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Collections' }

export default async function PaymentsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  // Whole page is financial analytics — gate on see-analytics.
  if (!can(ctx, 'see-analytics')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Collections" />
        <AccessDenied ctx={ctx} permissionKey="see-analytics" />
      </>
    )
  }
  const showFinancials = can(ctx, 'see-financial-totals')

  const bundle = await getAnalyticsBundle()

  // DB functions not installed yet.
  if (!bundle.ready) {
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Collections" />
        <div className="px-4 sm:px-7 py-7">
          <div className="max-w-3xl mx-auto">
            <div className="border-2 border-[var(--color-ink)] p-6">
              <h2 className="font-bold text-[var(--color-ink)]">One-time setup needed</h2>
              <p className="text-sm text-[var(--color-neutral-700)] mt-2">
                The analytics aggregation functions aren&apos;t installed in the database yet.
                Run <code className="bg-[var(--color-surface)] px-1">db/analytics_functions.sql</code> in
                the Supabase SQL editor, then refresh this page.
              </p>
              {bundle.error && <p className="text-xs text-[var(--color-neutral-700)] mt-3 font-mono">{bundle.error}</p>}
            </div>
          </div>
        </div>
      </>
    )
  }

  if (!bundle.hasData) {
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Collections" />
        <div className="px-4 sm:px-7 py-7">
          <div className="max-w-7xl mx-auto py-12 border-t-2 border-[var(--color-ink)]" style={{ maxWidth: '60ch' }}>
            <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">Nothing to analyse yet</p>
            <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)]">
              No billing cycles yet. Create a term and generate invoices to see payment insights here.
            </p>
          </div>
        </div>
      </>
    )
  }

  // Comparisons and trend lines need a closed term to measure against — an
  // open term's totals are still moving, so charting them alongside history
  // reads as "empty axes" rather than a trend. Say how far off that is
  // instead of rendering the dashboard with too little history to compare.
  // Reuses the term series already fetched above (it carries each cycle's
  // status) instead of a second query just to count closed cycles.
  const closedTermCount = bundle.termSeries.filter(t => t.status === 'closed').length
  const MIN_CLOSED_TERMS_FOR_TREND = 2
  if (closedTermCount < MIN_CLOSED_TERMS_FOR_TREND) {
    const remaining = MIN_CLOSED_TERMS_FOR_TREND - closedTermCount
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Collections" />
        <div className="px-4 sm:px-7 py-7">
          <div className="max-w-7xl mx-auto py-12 border-t-2 border-[var(--color-ink)]" style={{ maxWidth: '60ch' }}>
            <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">Nothing to analyse yet</p>
            <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)]">
              {closedTermCount === 0
                ? `Needs a closed term to compare against — ${remaining} more terms before the trend means anything.`
                : `One closed term so far — ${remaining} more before the trend means anything.`}
            </p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <WorkspaceHeader workspaceKey="money" title="Collections" />
      {/* Full-bleed ink dashboard: no padding wrapper — the dashboard carries
          its own interior padding, flush under the tabs (App Shell INK GROUND). */}
      <PaymentsDashboard
        bundle={showFinancials ? bundle : redactAnalyticsBundle(bundle)}
        showFinancials={showFinancials}
        schoolId={ctx?.schoolId ?? ''}
      />
    </>
  )
}
