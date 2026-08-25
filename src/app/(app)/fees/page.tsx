import Link from 'next/link'
import { getFeesOverview, getAllCycles } from '@/lib/queries/fees'
import TermSelector from '@/components/fees/TermSelector'
import { getAuthContext, can } from '@/lib/auth/permissions'

interface PageProps {
  searchParams: Promise<{ cycle?: string }>
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

export default async function FeesOverviewPage({ searchParams }: PageProps) {
  const { cycle: cycleParam } = await searchParams
  
  const [data, allCycles] = await Promise.all([
    getFeesOverview(cycleParam),
    getAllCycles(),
  ])

  const currentCycleId = allCycles.find(c => c.name === data.currentTermName)?.id || null
  const isClosedTerm = data.currentTermStatus === 'closed'

  const ctx = await getAuthContext()
  const showFinancials = can(ctx, 'see-financial-totals')

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        {/* Header */}
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-navy">Fees</h1>
            <p className="text-gray-500 mt-2 text-sm">
              Manage fee structure, billing cycles, and invoices
            </p>
          </div>
          {allCycles.length > 0 && (
            <TermSelector
              cycles={allCycles}
              currentCycleId={currentCycleId}
              paramName="cycle"
            />
          )}
        </header>

        {isClosedTerm && (
          <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-navy">Viewing closed term — read only</p>
              <p className="text-xs text-gray-600 mt-0.5">
                Historical data for {data.currentTermName}. Switch to an active term to make changes.
              </p>
            </div>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">

          {showFinancials && (
          <div className="bg-white p-5 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Total expected</p>
                <p className="text-2xl font-bold text-navy">{formatNaira(data.totalExpectedThisTerm)}</p>
                <p className="text-xs text-gray-500 mt-1">For {data.currentTermName || 'this term'}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                </svg>
              </div>
            </div>
          </div>
          )}

          {showFinancials && (
          <div className="bg-white p-5 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Total collected</p>
                <p className="text-2xl font-bold text-mint">{formatNaira(data.totalCollected)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {data.totalExpectedThisTerm > 0
                    ? `${Math.round((data.totalCollected / data.totalExpectedThisTerm) * 100)}% collected`
                    : 'Nothing collected yet'}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          </div>
          )}

          {showFinancials && (
          <div className="bg-white p-5 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Outstanding</p>
                <p className="text-2xl font-bold text-amber-600">{formatNaira(data.totalOutstanding)}</p>
                <p className="text-xs text-gray-500 mt-1">Awaiting payment</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
          </div>
          )}

          <div className="bg-white p-5 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Students invoiced</p>
                <p className="text-2xl font-bold text-navy">
                  {data.studentsWithInvoices} <span className="text-gray-400">of {data.totalActiveStudents}</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {data.totalActiveStudents > 0
                    ? `${Math.round((data.studentsWithInvoices / data.totalActiveStudents) * 100)}% invoiced`
                    : 'No active students'}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>

        </div>

        {/* Navigation cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          
          {can(ctx, 'see-invoices') && (
          <Link
            href="/invoices"
            className="bg-white p-6 rounded-xl border border-gray-200 hover:border-mint hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-mint-light flex items-center justify-center">
                <svg className="w-6 h-6 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <svg className="w-5 h-5 text-gray-300 group-hover:text-mint transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-navy font-semibold text-lg mb-1">Invoices</h3>
            <p className="text-sm text-gray-500">Search and browse every invoice</p>
          </Link>
          )}

          {can(ctx, 'see-fee-structure') && (
          <Link
            href={currentCycleId ? `/fees/structure?cycle=${currentCycleId}` : '/fees/structure'}
            className="bg-white p-6 rounded-xl border border-gray-200 hover:border-mint hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-mint-light flex items-center justify-center">
                <svg className="w-6 h-6 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <svg className="w-5 h-5 text-gray-300 group-hover:text-mint transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-navy font-semibold text-lg mb-1">Fee structure</h3>
            <p className="text-sm text-gray-500">Set fees for each class</p>
          </Link>
          )}

          {can(ctx, 'see-fee-structure') && (
          <Link
            href="/fees/cycles"
            className="bg-white p-6 rounded-xl border border-gray-200 hover:border-mint hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-mint-light flex items-center justify-center">
                <svg className="w-6 h-6 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <svg className="w-5 h-5 text-gray-300 group-hover:text-mint transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-navy font-semibold text-lg mb-1">Billing cycles</h3>
            <p className="text-sm text-gray-500">Manage terms and invoice generation</p>
          </Link>
          )}

        </div>

        {/* Recent activity placeholder */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <h2 className="text-navy font-semibold text-lg mb-4">Recent activity</h2>
          <p className="text-gray-500 text-sm py-4">
            Activity feed will appear here once invoice generation and fee changes are made.
          </p>
        </div>

      </div>
    </main>
  )
}