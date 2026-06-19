import Link from 'next/link'
import { getFeeStructure } from '@/lib/queries/fees'
import FeeStructureLayout from '@/components/FeeStructureLayout'

interface PageProps {
  searchParams: Promise<{ view?: string, class?: string }>
}

export default async function FeeStructurePage({ searchParams }: PageProps) {
  const { view, class: classParam } = await searchParams
  const data = await getFeeStructure()

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        {/* Breadcrumb */}
        <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/fees" className="hover:text-navy">Fees</Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-navy font-medium">Fee structure</span>
        </nav>

        {!data ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <FeeStructureLayout
            data={data}
            initialView={view === 'item' ? 'item' : 'class'}
            initialClassId={classParam}
          />
        )}

      </div>
    </main>
  )
}