import Link from 'next/link'
import { getFeeStructure, getAllCycles } from '@/lib/queries/fees'
import FeeStructureLayout from '@/components/FeeStructureLayout'
import TermSelector from '@/components/TermSelector'

interface PageProps {
  searchParams: Promise<{ view?: string, class?: string, cycle?: string }>
}

export default async function FeeStructurePage({ searchParams }: PageProps) {
  const { view, class: classParam, cycle: cycleParam } = await searchParams

  const [data, allCycles] = await Promise.all([
    getFeeStructure(cycleParam),
    getAllCycles(),
  ])

  const currentCycleId = data?.cycle?.id || null
  const isClosedTerm = data?.cycle?.status === 'closed'

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        <nav className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/fees" className="hover:text-navy">Fees</Link>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-navy font-medium">Fee structure</span>
          </div>

          {allCycles.length > 0 && (
            <TermSelector
              cycles={allCycles}
              currentCycleId={currentCycleId}
              paramName="cycle"
            />
          )}
        </nav>

        {isClosedTerm && (
          <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-navy">This term is closed</p>
              <p className="text-xs text-gray-600 mt-0.5">
                Fee data is read-only. To make changes, go to <Link href="/fees/cycles" className="text-mint hover:underline">Billing cycles</Link> and reopen this term as a draft.
              </p>
            </div>
          </div>
        )}

        {!data ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <FeeStructureLayout
            data={data}
            initialView={view === 'item' ? 'item' : 'class'}
            initialClassId={classParam}
            readOnly={isClosedTerm}
          />
        )}

      </div>
    </main>
  )
}