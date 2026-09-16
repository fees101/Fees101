import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import CycleDetailLayout from '@/components/fees/CycleDetailLayout'
import { getCycleDetailById, CycleInvoiceFilter, CYCLE_INVOICES_PAGE_SIZE_OPTIONS } from '@/lib/queries/fees'
import { getAuthContext, can } from '@/lib/auth/permissions'

// Server Actions invoked from this page (generateInvoicesForCycle's initial
// synchronous portion, closeTermAndCarryForward, the staleness-check preload
// on load, etc.) can run long for a large school — bump to Vercel Hobby's
// 60s ceiling instead of the platform default. Config only, no behavior
// change.
export const maxDuration = 60

const VALID_FILTERS: CycleInvoiceFilter[] = ['all', 'paid', 'partial', 'unpaid', 'needs_resend', 'out_of_date', 'no_invoice']

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function CycleDetailPage({ params, searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-fee-structure')) redirect('/fees')
  const showFinancials = can(ctx, 'see-financial-totals')

  const { id } = await params
  const sp = await searchParams
  const filterParam = (Array.isArray(sp.filter) ? sp.filter[0] : sp.filter) || 'all'
  const filter = VALID_FILTERS.includes(filterParam as CycleInvoiceFilter) ? (filterParam as CycleInvoiceFilter) : 'all'
  const search = (Array.isArray(sp.search) ? sp.search[0] : sp.search) || ''
  const page = Math.max(1, parseInt((Array.isArray(sp.page) ? sp.page[0] : sp.page) || '1', 10) || 1)
  const perPageRaw = parseInt((Array.isArray(sp.perPage) ? sp.perPage[0] : sp.perPage) || '50', 10)
  const perPage = CYCLE_INVOICES_PAGE_SIZE_OPTIONS.includes(perPageRaw) ? perPageRaw : 50

  const data = await getCycleDetailById(id, { filter, search, page, perPage })

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

        <CycleDetailLayout data={data} showFinancials={showFinancials} />

      </div>
    </main>
  )
}