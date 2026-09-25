import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import CycleDetailLayout from '@/components/fees/CycleDetailLayout'
import { getCycleDetailById, getAllCycles, getSessions, CycleInvoiceFilter, CYCLE_INVOICES_PAGE_SIZE_OPTIONS } from '@/lib/queries/fees'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Term overview' }

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
  if (!can(ctx, 'see-fee-structure')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="fees" title="Term overview" back={{ href: '/fees/cycles', label: 'Cycles' }} />
        <AccessDenied ctx={ctx} permissionKey="see-fee-structure" />
      </>
    )
  }
  const showFinancials = can(ctx, 'see-financial-totals')

  const { id } = await params
  const sp = await searchParams
  const filterParam = (Array.isArray(sp.filter) ? sp.filter[0] : sp.filter) || 'all'
  const filter = VALID_FILTERS.includes(filterParam as CycleInvoiceFilter) ? (filterParam as CycleInvoiceFilter) : 'all'
  const search = (Array.isArray(sp.search) ? sp.search[0] : sp.search) || ''
  const page = Math.max(1, parseInt((Array.isArray(sp.page) ? sp.page[0] : sp.page) || '1', 10) || 1)
  const perPageRaw = parseInt((Array.isArray(sp.perPage) ? sp.perPage[0] : sp.perPage) || '50', 10)
  const perPage = CYCLE_INVOICES_PAGE_SIZE_OPTIONS.includes(perPageRaw) ? perPageRaw : 50

  // The detail invoice data is the heavy fetch; cycles + sessions are the light
  // lists the hub needs to activate a draft (past-session guard) and to edit the
  // term's details in place. All read-only, run together.
  const [data, cycles, sessions] = await Promise.all([
    getCycleDetailById(id, { filter, search, page, perPage }),
    getAllCycles(),
    getSessions(),
  ])

  if (!data) notFound()

  return (
    <>
      <WorkspaceHeader
        workspaceKey="fees"
        title={data.cycle?.name || 'Term'}
        back={{ href: '/fees/cycles', label: 'Cycles' }}
      />

      <div className="px-4 sm:px-7 py-7">
        <div>

          <CycleDetailLayout
            data={data}
            cycles={cycles}
            sessions={sessions}
            showFinancials={showFinancials}
            schoolId={ctx.schoolId ?? ''}
          />

        </div>
      </div>
    </>
  )
}
