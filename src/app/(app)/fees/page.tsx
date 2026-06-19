import Link from 'next/link'
import { getFeesOverview } from '@/lib/queries/fees'

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

export default async function FeesOverviewPage() {
  const data = await getFeesOverview()

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        {/* Header */}
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-navy">Fees</h1>
            <p className="text-gray-500 mt-2 text-sm">
              Manage classes, fees, and invoices
            </p>
          </div>
          {data.hasCurrentTerm && (
            <div className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-gray-600">Current term:</span>
              <span className="text-navy font-medium">{data.currentTermName}</span>
            </div>
          )}
        </header>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          
          <div className="bg-white p-5 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Total expected this term</p>
                <p className="text-2xl font-bold text-navy">{formatNaira(data.totalExpectedThisTerm)}</p>
                <p className="text-xs text-gray-500 mt-1">Across all classes</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1">Active classes</p>
                <p className="text-2xl font-bold text-navy">{data.activeClasses}</p>
                <p className="text-xs text-gray-500 mt-1">{data.activeClasses === 1 ? 'Class is' : 'Classes are'} active</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
            </div>
          </div>

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
          
          <Link 
            href="/fees/classes"
            className="bg-white p-6 rounded-xl border border-gray-200 hover:border-mint hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-mint-light flex items-center justify-center">
                <svg className="w-6 h-6 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                </svg>
              </div>
              <svg className="w-5 h-5 text-gray-300 group-hover:text-mint transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-navy font-semibold text-lg mb-1">Classes</h3>
            <p className="text-sm text-gray-500">Manage your school&apos;s classes</p>
          </Link>

          <Link 
            href="/fees/structure"
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