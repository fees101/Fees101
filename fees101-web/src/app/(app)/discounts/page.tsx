import { redirect } from 'next/navigation'
import { getPendingDiscountRequests, getActiveRecurringDiscounts, getRecentDecidedDiscountRequests } from '@/lib/queries/discountRequests'
import DiscountQueue from '@/components/discounts/DiscountQueue'
import DiscountsRealtimeRefresh from '@/components/discounts/DiscountsRealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Discounts' }

export default async function DiscountsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  // Reachable with either permission: approve-discounts needs this page to do
  // its job (there's no separate approval route), so it can't be gated behind
  // see-discounts alone.
  if (!can(ctx, 'see-discounts') && !can(ctx, 'approve-discounts')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="discounts" title="Discounts" />
        <AccessDenied ctx={ctx} label="see or approve discounts" />
      </>
    )
  }

  // Whether the approve/reject/revoke controls render — enforced again
  // server-side in discounts/actions.ts.
  const canApprove = can(ctx, 'approve-discounts')

  const [requests, recurring, decided] = await Promise.all([
    getPendingDiscountRequests(),
    getActiveRecurringDiscounts(),
    getRecentDecidedDiscountRequests(),
  ])

  return (
    <>
      {ctx.schoolId && <DiscountsRealtimeRefresh schoolId={ctx.schoolId} />}

      {/* DiscountQueue renders its own WorkspaceHeader — its Queue/Recurring
          toggle is client state, not a route, so it's passed through as
          WorkspaceHeader's `tabs` prop rather than navConfig modes, keeping
          the same merged title-rule-tabs treatment every other page gets. */}
      <DiscountQueue requests={requests} recurring={recurring} decided={decided} canApprove={canApprove} />
    </>
  )
}
