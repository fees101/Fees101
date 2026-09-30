import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import InvoicesListLayout from '@/components/invoices/InvoicesListLayout'
import { getAllInvoicesForList, type InvoiceStatusFilter } from '@/lib/queries/fees'
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

const STATUS_FILTERS: InvoiceStatusFilter[] = ['all', 'settled', 'partial', 'overdue', 'needs_resend']

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
  const termFilter = params.term || 'all'
  const search = params.q || ''
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const perPage = parseInt(params.perPage || '50', 10) || 50

  const result = await getAllInvoicesForList({ statusFilter, termFilter, search, page, perPage })

  return (
    <Suspense fallback={null}>
      <InvoicesListLayout
        {...result}
        statusFilter={statusFilter}
        termFilter={termFilter}
        search={search}
        schoolId={ctx.schoolId ?? ''}
      />
    </Suspense>
  )
}
