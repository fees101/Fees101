import { redirect } from 'next/navigation'
import { getPendingDiscountRequests, getActiveRecurringDiscounts } from '@/lib/queries/discountRequests'
import DiscountRequestsList from '@/components/discounts/DiscountRequestsList'
import ActiveRecurringDiscountsList from '@/components/discounts/ActiveRecurringDiscountsList'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function DiscountsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-discounts')) redirect('/dashboard')

  // Whether the approve/reject controls render — enforced again server-side in
  // discounts/actions.ts.
  const canApprove = can(ctx, 'approve-discounts')

  const [requests, recurring] = await Promise.all([
    getPendingDiscountRequests(),
    getActiveRecurringDiscounts(),
  ])

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto space-y-8">
        <div>
          <header className="mb-6">
            <h1 className="text-3xl font-bold text-navy">Discount requests</h1>
            <p className="text-sm text-gray-500 mt-1">Approve or reject staff-child, scholarship, bursary and hardship discount requests</p>
          </header>

          <DiscountRequestsList requests={requests} canApprove={canApprove} />
        </div>

        <div>
          <header className="mb-4">
            <h2 className="text-xl font-bold text-navy">Active recurring discounts</h2>
            <p className="text-sm text-gray-500 mt-1">Carry forward automatically to every future invoice — revoke one if it should stop (e.g. a staff member leaves)</p>
          </header>

          <ActiveRecurringDiscountsList discounts={recurring} canApprove={canApprove} />
        </div>
      </div>
    </main>
  )
}

