import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPendingDiscountRequests, getActiveRecurringDiscounts } from '@/lib/queries/discountRequests'
import DiscountRequestsList from '@/components/discounts/DiscountRequestsList'
import ActiveRecurringDiscountsList from '@/components/discounts/ActiveRecurringDiscountsList'

export default async function DiscountsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'school_admin' && profile?.role !== 'super_admin') redirect('/dashboard')

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

          <DiscountRequestsList requests={requests} />
        </div>

        <div>
          <header className="mb-4">
            <h2 className="text-xl font-bold text-navy">Active recurring discounts</h2>
            <p className="text-sm text-gray-500 mt-1">Carry forward automatically to every future invoice — revoke one if it should stop (e.g. a staff member leaves)</p>
          </header>

          <ActiveRecurringDiscountsList discounts={recurring} />
        </div>
      </div>
    </main>
  )
}

