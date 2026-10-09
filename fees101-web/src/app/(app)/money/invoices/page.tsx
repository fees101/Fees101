import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import InvoicesListLayout from '@/components/invoices/InvoicesListLayout'
import { getAllInvoicesForList, getCreditOnFile, type InvoiceStatusFilter } from '@/lib/queries/fees'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Invoices' }

interface PageProps {
  searchParams: Promise<{
    filter?: string
    term?: string
    q?: string
    page?: string
    perPage?: string
  }>
}

const STATUS_FILTERS: InvoiceStatusFilter[] = ['all', 'settled', 'partial', 'overdue', 'needs_resend', 'stale_students']

// A link elsewhere in the app (e.g. the dashboard's "invoices changed — not
// resent" KPI card) points here with the older, coarser vocabulary — map it
// onto today's chip values so those links keep working.
function normalizeStatusFilter(raw: string | undefined): InvoiceStatusFilter {
  if (raw === 'needs_resend' || raw === 'partial') return raw
  if (raw === 'unpaid' || raw === 'overdue') return 'overdue'
  if (raw === 'paid') return 'settled'
  return STATUS_FILTERS.includes(raw as InvoiceStatusFilter) ? (raw as InvoiceStatusFilter) : 'all'
}

export default async function InvoicesPage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-invoices')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Invoices" />
        <AccessDenied ctx={ctx} permissionKey="see-invoices" />
      </>
    )
  }

  const params = await searchParams
  const statusFilter = normalizeStatusFilter(params.filter)
  // Default to the active term when no ?term= is present at all (a fresh
  // visit to this tab) — a bursar's day-to-day work is almost always this
  // term's invoices, not the full lifetime list. Only a genuinely absent
  // param defaults this way: picking "All terms" from the dropdown sets
  // ?term=all explicitly, which is left alone here, not overridden back to
  // the active term.
  let termFilter: string = params.term ?? ''
  if (!termFilter) {
    const { data: activeCycle } = await ctx.supabase
      .from('billing_cycles')
      .select('id')
      .eq('school_id', ctx.schoolId || '')
      .eq('status', 'active')
      .maybeSingle()
    termFilter = activeCycle?.id || 'all'
  }
  const search = params.q || ''
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const perPage = parseInt(params.perPage || '50', 10) || 50

  const result = await getAllInvoicesForList({ statusFilter, termFilter, search, page, perPage })
  const creditOnFile = await getCreditOnFile()

  return (
    <Suspense fallback={null}>
      <InvoicesListLayout
        {...result}
        statusFilter={statusFilter}
        termFilter={termFilter}
        search={search}
        creditOnFile={creditOnFile}
        schoolId={ctx.schoolId ?? ''}
      />
    </Suspense>
  )
}
