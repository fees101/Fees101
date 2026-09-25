import { redirect } from 'next/navigation'
import { getDashboardKPIs, getCollectionByClass, getRecentActivity } from '@/lib/queries/dashboard'
import CollectionChart from '@/components/dashboard/CollectionChart'
import RecentActivity from '@/components/dashboard/RecentActivity'
import NoWidgetsFallback from '@/components/dashboard/NoWidgetsFallback'
import NeedsYouList, { type NeedsYouItem } from '@/components/dashboard/NeedsYouList'
import DashboardRealtimeRefresh from '@/components/dashboard/DashboardRealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getAccessibleNavItems, getPermissionScopedNavItems, hasDashboardWidgets } from '@/lib/nav/navConfig'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Today' }

function formatNaira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function formatCloseDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function Dashboard() {
  // Single auth/profile round-trip (React cache()'d), shared with the layout
  // above it - no separate createClient()/getUser()/profile lookup here.
  const authCtx = await getAuthContext()
  const canSeeActivity = can(authCtx, 'see-activity')
  const showFinancials = can(authCtx, 'see-financial-totals')
  const canApproveDiscounts = can(authCtx, 'approve-discounts')
  const canManageInvoices = can(authCtx, 'manage-invoices')
  const canSeeInvoices = can(authCtx, 'see-invoices')
  const canSeeStudents = can(authCtx, 'see-students')
  // Whether this viewer holds any permission that can put a row in "Needs you".
  // Drives the empty-state copy: someone who carries queue actions but has a
  // clear queue reads "Nothing is waiting on you", while someone whose role
  // never queues anything is told so plainly rather than shown a blank space.
  const carriesQueueActions = canSeeInvoices || canManageInvoices || canApproveDiscounts || canSeeStudents

  const permissions = authCtx?.permissions ?? new Set<string>()
  const isOwner = authCtx?.isOwner ?? false
  const hasWidgets = hasDashboardWidgets(permissions, isOwner)

  // A role with no dashboard widgets and exactly one real (permission-gated)
  // destination goes straight there instead of landing on an empty
  // dashboard - revisit if that single destination ever feels too scanty as
  // a landing page once the rest of the UI is finalized.
  if (!hasWidgets) {
    const scoped = getPermissionScopedNavItems(permissions, isOwner)
    if (scoped.length === 1) redirect(scoped[0].href)
  }

  const [kpis, classData, activity] = await Promise.all([
    getDashboardKPIs(),
    showFinancials ? getCollectionByClass() : Promise.resolve([]),
    canSeeActivity ? getRecentActivity(7, showFinancials) : Promise.resolve([]),
  ])

  const hasTerm = Boolean(kpis.currentCycleName)

  // "Needs you" — one row per outstanding obligation this viewer can act on,
  // built worst-first so money at risk leads. Each row is gated on the same
  // permission that would let the viewer resolve it; a row is omitted when its
  // count is zero. Status words are ochre (a state that needs a human), never
  // green — green is reserved for money that actually arrived.
  const needsYou: NeedsYouItem[] = []

  if (canSeeInvoices && kpis.overdue14Count > 0) {
    needsYou.push({
      key: 'overdue',
      title: `${plural(kpis.overdue14Count, 'invoice')} overdue past 14 days`,
      subtitle: 'Past due for more than two weeks.',
      amount: kpis.overdue14Amount,
      status: 'Overdue',
      href: '/money/invoices',
    })
  }
  if (canManageInvoices && kpis.needsResendCount > 0) {
    needsYou.push({
      key: 'resend',
      title: `${plural(kpis.needsResendCount, 'invoice')} changed and not resent`,
      subtitle: 'Parents still hold the old figures.',
      amount: kpis.needsResendAmount,
      status: 'Needs resend',
      href: '/money/invoices?filter=needs_resend',
      resendCount: kpis.needsResendCount,
    })
  }
  if (canApproveDiscounts && kpis.pendingApprovalsCount > 0) {
    needsYou.push({
      key: 'discounts',
      title: `${plural(kpis.pendingApprovalsCount, 'discount request')} awaiting you`,
      subtitle: 'Review and approve or decline.',
      amount: kpis.pendingApprovalsAmount,
      status: 'Pending',
      href: '/discounts',
    })
  }
  if (canSeeStudents && kpis.unbilledCount > 0) {
    needsYou.push({
      key: 'unbilled',
      title: `${plural(kpis.unbilledCount, 'student')} with no invoice this term`,
      subtitle: 'Not billed in the current term.',
      amount: null,
      status: 'Not billed',
      href: '/students',
    })
  }

  // Hero collection bar, composed over what the term expected: the collected
  // portion, then overdue, then still-due-later. They sum to expected.
  const exp = kpis.totalExpected
  const collectedAlloc = Math.max(0, exp - kpis.totalOutstanding)
  const barCollected = exp > 0 ? (collectedAlloc / exp) * 100 : 0
  const barOverdue = exp > 0 ? (kpis.overdueAmount / exp) * 100 : 0
  const barDueLater = exp > 0 ? (kpis.dueLaterAmount / exp) * 100 : 0

  return (
    <>
      {authCtx?.schoolId && <DashboardRealtimeRefresh schoolId={authCtx.schoolId} />}
      <WorkspaceHeader workspaceKey="today" title="Today" />

      {/* Body gutter (28px) aligns with the header gutter — flush-left, full
          width, no centered max-w container. Replicates the App Shell's Today. */}
      <div className="px-4 sm:px-7 py-7">

        {!hasWidgets && (
          <NoWidgetsFallback items={getAccessibleNavItems(permissions, isOwner)} />
        )}

        {hasWidgets && (
          <div className="m-2col">

            {/* Left: collection hero, needs-you queue, collection by class */}
            <div>

              {/* Viewer without see-financial-totals: explain the absence of the
                  money hero rather than leaving the column to start abruptly on
                  "Needs you". Left-rule, no fill (per the no-caution-banners
                  rule) instead of the canvas's tinted panel. */}
              {!showFinancials && (
                <section className="m-panel">
                  <p className="text-[11px] tracking-[0.16em] uppercase text-[var(--color-neutral-700)] mb-2">
                    Collected{hasTerm ? ` · ${kpis.currentCycleName}` : ''}
                  </p>
                  <div style={{ borderLeft: '2px solid var(--color-ink)', paddingLeft: 16, maxWidth: '62ch' }}>
                    <p className="text-[17px] font-bold text-[var(--color-ink)] mb-1.5">Money figures are not part of your role.</p>
                    <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)] mb-1">
                      School-wide totals, collection rates and the class breakdown need the See financial totals key.
                      Nothing about an individual family is hidden from you. Only the aggregate view belongs to the
                      bursar and the owner.
                    </p>
                    <p className="text-[13px] text-[var(--color-neutral-700)] m-0">Ask the bursar or the owner to grant it.</p>
                  </div>
                </section>
              )}

              {showFinancials && (hasTerm ? (
                <section className="m-panel">
                  <div className="flex flex-wrap items-end justify-between gap-5 mb-4">
                    <div>
                      <p className="text-[11px] tracking-[0.16em] uppercase text-[var(--color-neutral-700)] mb-2">
                        Collected · {kpis.currentCycleName}
                      </p>
                      <p className="text-[40px] sm:text-[54px] font-extrabold leading-[0.9] tracking-[-0.03em] text-[var(--color-ledger)] m-num">
                        {formatNaira(kpis.totalCollected)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[26px] font-extrabold leading-none text-[var(--color-ink)] m-num">
                        {kpis.collectionPercentage}%
                      </p>
                      <p className="text-[13px] text-[var(--color-neutral-700)] mt-1 m-num">
                        of {formatNaira(kpis.totalExpected)}
                      </p>
                    </div>
                  </div>
                  <div className="flex h-2 w-full bg-[var(--color-neutral-300)] mb-2.5">
                    <span className="h-full bg-[var(--color-ledger)]" style={{ width: `${barCollected}%` }} />
                    <span className="h-full bg-[var(--color-ochre)]" style={{ width: `${barOverdue}%` }} />
                    <span className="h-full bg-[var(--color-neutral-300)]" style={{ width: `${barDueLater}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-x-[22px] gap-y-1 text-[13px] text-[var(--color-neutral-800)]">
                    {kpis.overdueAmount > 0 && (
                      <span><strong className="m-num">{formatNaira(kpis.overdueAmount)}</strong> overdue</span>
                    )}
                    {kpis.dueLaterAmount > 0 && (
                      <span><strong className="m-num">{formatNaira(kpis.dueLaterAmount)}</strong> due later</span>
                    )}
                    {kpis.daysToClose !== null && (
                      <span className="text-[var(--color-neutral-700)] m-num">{plural(kpis.daysToClose, 'day')} to term close</span>
                    )}
                  </div>
                </section>
              ) : (
                <section className="m-panel">
                  <p className="text-[11px] tracking-[0.16em] uppercase text-[var(--color-neutral-700)] mb-2">Collected</p>
                  <p className="text-sm text-[var(--color-neutral-700)]">
                    No active term yet. Create one to start billing.
                  </p>
                </section>
              ))}

              {(needsYou.length > 0 || carriesQueueActions) && (
                <section className="m-panel">
                  <div className="flex items-baseline justify-between mb-1">
                    <h2 className="text-[22px] font-extrabold text-[var(--color-ink)]">Needs you</h2>
                    <span className="text-[12px] tracking-[0.08em] uppercase text-[var(--color-neutral-700)] m-num">
                      {needsYou.length > 0 ? plural(needsYou.length, 'item') : 'Clear'}
                    </span>
                  </div>
                  {needsYou.length > 0 ? (
                    <>
                      <p className="text-[14px] text-[var(--color-neutral-800)] max-w-[58ch] mb-2">
                        Ordered by money at risk, not by recency. Everything here is one click from resolution.
                      </p>
                      <NeedsYouList items={needsYou} showFinancials={showFinancials} />
                    </>
                  ) : (
                    <div className="border-t border-[var(--color-neutral-300)] py-5">
                      <p className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Nothing is waiting on you.</p>
                      <p className="text-[14px] text-[var(--color-neutral-800)] leading-[1.5] max-w-[58ch]">
                        Everything that would queue here is settled. Overdue invoices, discount requests and unbilled
                        students appear here as they come up.
                      </p>
                    </div>
                  )}
                </section>
              )}

              {showFinancials && classData.length > 0 && (
                <CollectionChart data={classData} />
              )}

            </div>

            {/* Right: record feed, term panel */}
            <div>

              {canSeeActivity && <RecentActivity events={activity} />}

              {showFinancials && hasTerm && (
                <section className="m-panel">
                  <h2 className="text-[18px] font-extrabold text-[var(--color-ink)] mb-3">Term</h2>
                  <div className="m-row grid grid-cols-[1fr_auto] gap-2 py-[9px]">
                    <span className="text-[13px] text-[var(--color-neutral-800)]">{kpis.currentCycleName}</span>
                    <span className="text-[12px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ink)]">Active</span>
                  </div>
                  <div className="m-row grid grid-cols-[1fr_auto] gap-2 py-[9px]">
                    <span className="text-[13px] text-[var(--color-neutral-800)]">Invoices issued</span>
                    <span className="text-[13px] text-[var(--color-ink)] m-num">{kpis.invoicesIssued}</span>
                  </div>
                  <div className="m-row grid grid-cols-[1fr_auto] gap-2 py-[9px]">
                    <span className="text-[13px] text-[var(--color-neutral-800)]">Students billed</span>
                    <span className="text-[13px] text-[var(--color-ink)] m-num">{kpis.studentsBilled} / {kpis.studentsCount}</span>
                  </div>
                  <div className="m-row grid grid-cols-[1fr_auto] gap-2 py-[9px]">
                    <span className="text-[13px] text-[var(--color-neutral-800)]">Closes</span>
                    <span className="text-[13px] text-[var(--color-ink)] m-num">{formatCloseDate(kpis.closeDate)}</span>
                  </div>
                </section>
              )}

            </div>

          </div>
        )}

      </div>
    </>
  )
}
