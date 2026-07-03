import { notFound } from 'next/navigation'
import Link from 'next/link'
import CycleDetailLayout from '@/components/CycleDetailLayout'
import { getCycleDetailById } from '@/lib/queries/fees'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CycleDetailPage({ params }: PageProps) {
  const { id } = await params
  const data = await getCycleDetailById(id)

  if (!data) notFound()

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/fees" className="hover:text-navy">Fees</Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <Link href="/fees/cycles" className="hover:text-navy">Billing cycles</Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-navy font-medium">{data.cycle?.name || 'Term'}</span>
        </nav>

        <CycleDetailLayout data={data} />

      </div>
    </main>
  )
}