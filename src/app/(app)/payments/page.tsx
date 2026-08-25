import { redirect } from 'next/navigation'
import { getAnalyticsBundle } from '@/lib/queries/analytics'
import PaymentsDashboard from '@/components/payments/PaymentsDashboard'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function PaymentsPage() {
  const ctx = await getAuthContext()
  // Whole page is financial analytics — gate on see-analytics.
  if (!can(ctx, 'see-analytics')) redirect('/dashboard')
  const showFinancials = can(ctx, 'see-financial-totals')

  const bundle = await getAnalyticsBundle()

  // DB functions not installed yet.
  if (!bundle.ready) {
    return (
      <main className="px-6 py-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold text-navy">Payments</h1>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="font-bold text-amber-800">One-time setup needed</h2>
            <p className="text-sm text-amber-700 mt-2">
              The analytics aggregation functions aren&apos;t installed in the database yet.
              Run <code className="bg-amber-100 px-1 rounded">db/analytics_functions.sql</code> in
              the Supabase SQL editor, then refresh this page.
            </p>
            {bundle.error && <p className="text-xs text-amber-600 mt-3 font-mono">{bundle.error}</p>}
          </div>
        </div>
      </main>
    )
  }

  if (!bundle.hasData) {
    return (
      <main className="px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-navy">Payments</h1>
          <p className="mt-4 text-gray-500">
            No billing cycles yet. Create a term and generate invoices to see payment insights here.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <PaymentsDashboard bundle={bundle} showFinancials={showFinancials} />
      </div>
    </main>
  )
}
