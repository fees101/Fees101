import { redirect } from 'next/navigation'
import { getDashboardKPIs, getCollectionByClass, getRecentActivity, getNeedsYouAttention } from '@/lib/queries/dashboard'
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
  const canManageStudents = can(authCtx, 'manage-students')
  const canApproveManualPayments = can(authCtx, 'approve-manual-payments')
  const canManagePaymentConfig = can(authCtx, 'manage-payment-config')
  // Whether this viewer holds any permission that can put a row in "Needs you".
  // Drives the empty-state copy: someone who carries queue actions but has a
  // clear queue reads "Nothing is waiting on you", while someone whose role
  // never queues anything is told so plainly rather than shown a blank space.
  const carriesQueueActions = canSeeInvoices || canManageInvoices || canApproveDiscounts || canSeeStudents || canManageStudents || canApproveManualPayments || canSeeActivity

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

  const [kpis, classData, activity, attention] = await Promise.all([
    getDashboardKPIs(),
    showFinancials ? getCollectionByClass() : Promise.resolve([]),
    canSeeActivity ? getRecentActivity(7, showFinancials) : Promise.resolve([]),
    // Operational attention items run alongside the finance KPIs. Each sub-query
    // only fires for a viewer who holds the permission that would let them act
    // on it, so a limited role never triggers a query it can't use.
    getNeedsYouAttention({
      flagged: canSeeActivity,
      unreachable: canManageStudents,
      manual: canApproveManualPayments,
      staleStudents: canSeeInvoices,
    }),
  ])

  const hasTerm = Boolean(kpis.currentCycleName)

  // "Needs you" — one row per outstanding obligation this viewer can act on,
  // built worst-first so money at risk leads. Each row is gated on the same
  // permission that would let the viewer resolve it; a row is omitted when its
  // count is zero. Status words are ochre (a state that needs a human), never
  // green — green is reserved for money that actually arrived.
  const needsYou: NeedsYouItem[] = []

  // Payment anomalies lead the queue: a flagged amount or a terminal mismatch
  // is the one thing here that can mean money already went wrong, not just money
  // owed. Count is the unread payment-anomaly notifications; the dedicated
  // /today/flagged page lists each one with its real detail and a link to the
  // student/family it's about, and self-clears as they're marked reviewed.
  if (canSeeActivity && attention.flaggedPaymentsCount > 0) {
    needsYou.push({
      key: 'flagged-payments',
      title: `${plural(attention.flaggedPaymentsCount, 'payment')} flagged for review`,
      subtitle: 'Came through but looked unusual. Check them or mark reviewed.',
      amount: null,
      status: 'Review',
      href: '/today/flagged',
    })
  }

  if (canSeeInvoices && kpis.overdue14Count > 0) {
    needsYou.push({
      key: 'overdue',
      title: `${plural(kpis.overdue14Count, 'invoice')} overdue past 14 days`,
      subtitle: 'Past due for more than two weeks.',
      amount: kpis.overdue14Amount,
      status: 'Overdue',
      href: '/money/invoices?filter=overdue',
    })
  }
  // Money on the books against a student who has already left — it won't collect
  // itself; the invoice wants cancelling or chasing. Clears when the invoice is
  // cancelled/settled or the student is reactivated.
  if (canSeeInvoices && attention.staleStudentInvoiceCount > 0) {
    needsYou.push({
      key: 'stale-student-invoices',
      title: `${plural(attention.staleStudentInvoiceCount, 'open invoice')} on students who left`,
      subtitle: 'Still owing on a withdrawn or graduated student.',
      amount: attention.staleStudentInvoiceAmount,
      status: 'Open invoice',
      href: '/money/invoices?filter=stale_students',
    })
  }
  // Families nobody can reach: every channel tried most recently failed, so an
  // invoice or reminder cannot land until their phone/email is fixed. Clears
  // automatically once a later message to the family delivers.
  if (canManageStudents && attention.unreachableFamiliesCount > 0) {
    needsYou.push({
      key: 'unreachable-families',
      title: `${attention.unreachableFamiliesCount} ${attention.unreachableFamiliesCount === 1 ? 'family' : 'families'} you can't reach`,
      subtitle: 'Recent messages failed on every channel. Check their phone and email.',
      amount: null,
      status: 'No contact',
      href: '/students?filter=unreachable',
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
  // Manual (cash/POS/cheque) payment requests waiting for an approver — only when
  // the feature is actually live for the school. Clears as each is approved or
  // rejected. Sits with the other approvals, below the discount queue.
  if (canApproveManualPayments && attention.manualPaymentEntryEnabled && attention.manualPaymentsPendingCount > 0) {
    needsYou.push({
      key: 'manual-payments',
      title: `${plural(attention.manualPaymentsPendingCount, 'manual payment')} awaiting approval`,
      subtitle: 'Cash, POS or cheque entries recorded by staff.',
      amount: null,
      status: 'Pending',
      href: '/discounts/manual-payments',
    })
  }
  if (canManageInvoices && kpis.cycleNeverInvoiced && kpis.currentCycleId) {
    needsYou.push({
      key: 'not-generated',
      title: `Invoices not generated for ${kpis.currentCycleName}`,
      subtitle: 'Generation has not run yet — students are ready to be invoiced.',
      amount: null,
      status: 'Not generated',
      href: `/fees/cycles/${kpis.currentCycleId}`,
      generateCycleId: kpis.currentCycleId,
      generateCount: kpis.studentsCount,
    })
  }
  if (canManageInvoices && !kpis.cycleNeverInvoiced && kpis.unbilledCount > 0 && kpis.currentCycleId) {
    needsYou.push({
      key: 'unbilled',
      title: `${plural(kpis.unbilledCount, 'student')} with no invoice this term`,
      subtitle: 'Not billed in the current term.',
      amount: null,
      status: 'Not billed',
      href: `/fees/cycles/${kpis.currentCycleId}`,
      generateCycleId: kpis.currentCycleId,
      generateCount: kpis.unbilledCount,
    })
  } else if (canSeeStudents && !canManageInvoices && !kpis.cycleNeverInvoiced && kpis.unbilledCount > 0) {
    needsYou.push({
      key: 'unbilled',
      title: `${plural(kpis.unbilledCount, 'student')} with no invoice this term`,
      subtitle: 'Not billed in the current term.',
      amount: null,
      status: 'Not billed',
      href: '/students?invoiceStatus=not_billed',
    })
  }
  if (canManagePaymentConfig && kpis.studentsWithoutDvaCount > 0) {
    needsYou.push({
      key: 'no-dva',
      title: `${plural(kpis.studentsWithoutDvaCount, 'student')} with no payment account`,
      subtitle: "Can't receive a transfer until an account exists.",
      amount: null,
      status: 'No account',
      href: '/students/payment-accounts',
      dvaCount: kpis.studentsWithoutDvaCount,
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

              {/* Viewer without see-financial-totals: instead of telling them a
                  figure is missing from their role (which just advertises what
                  they can't use), give the top slot a useful, money-free
                  operational snapshot — roster size, term, close date, billing
                  progress. The "Needs you" queue below carries their actions. */}
              {!showFinancials && (
                <section className="m-panel">
                  <div className="flex flex-wrap items-end justify-between gap-5 mb-4">
                    <div>
                      <p className="text-[11px] tracking-[0.16em] uppercase text-[var(--color-neutral-700)] mb-2">
                        {hasTerm ? kpis.currentCycleName : 'Your school'}
                      </p>
                      <p className="text-[40px] sm:text-[54px] font-extrabold leading-[0.9] tracking-[-0.03em] text-[var(--color-ink)] m-num">
                        {kpis.studentsCount}
                      </p>
                      <p className="text-[13px] text-[var(--color-neutral-700)] mt-1">{plural(kpis.studentsCount, 'student')}</p>
                    </div>
                    {hasTerm && kpis.closeDate && (
                      <div className="text-right">
                        <p className="text-[13px] text-[var(--color-neutral-700)] m-0">
                          {typeof kpis.daysToClose === 'number' && kpis.daysToClose < 0 ? 'Term closed' : 'Term closes'}
                        </p>
                        <p className="text-[17px] font-bold text-[var(--color-ink)] m-num">{formatCloseDate(kpis.closeDate)}</p>
                        {typeof kpis.daysToClose === 'number' && (
                          <p className="text-[13px] text-[var(--color-neutral-700)] m-num">
                            {kpis.daysToClose > 0
                              ? `${plural(kpis.daysToClose, 'day')} left`
                              : kpis.daysToClose === 0
                                ? 'Closes today'
                                : `${plural(-kpis.daysToClose, 'day')} ago`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {canSeeInvoices && hasTerm && (
                    <p className="text-[13px] text-[var(--color-neutral-700)] m-0 pt-2.5" style={{ borderTop: '1px solid var(--color-neutral-200)' }}>
                      <span className="m-num">{kpis.invoicesIssued}</span> {kpis.invoicesIssued === 1 ? 'invoice' : 'invoices'} issued
                      {' · '}
                      <span className="m-num">{kpis.unbilledCount}</span> not yet billed
                    </p>
                  )}
                </section>
              )}

              {showFinancials && (hasTerm ? (
                <section className="m-panel">
                  <div className="flex flex-wrap items-end justify-between gap-5 mb-4">
                    <div>
                      <p className="text-[11px] tracking-[0.16em] uppercase text-[var(--color-neutral-700)] mb-2" title="Cash received for this term's invoices, no matter when it was paid. Not a running cash-flow total.">
                        Collected · {kpis.currentCycleName}
                      </p>
                      <p className="text-[40px] sm:text-[54px] font-extrabold leading-[0.9] tracking-[-0.03em] text-[var(--color-ledger)] m-num">
                        {formatNaira(kpis.totalCollected)}
                      </p>
                      <p className="text-[12px] text-[var(--color-neutral-700)] mt-1.5 max-w-[34ch]">
                        Money received for this term&apos;s fees.
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
                      <span className="text-[var(--color-neutral-700)] m-num">
                        {kpis.daysToClose > 0
                          ? `${plural(kpis.daysToClose, 'day')} to term close`
                          : kpis.daysToClose === 0
                            ? 'term closes today'
                            : `term closed ${plural(-kpis.daysToClose, 'day')} ago`}
                      </span>
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
