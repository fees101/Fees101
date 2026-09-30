import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getInvoiceById } from '@/lib/queries/fees'
import { getDiscountSettings, mergeDiscountSettings } from '@/lib/queries/discounts'
import InvoiceDetailLayout from '@/components/invoices/InvoiceDetailLayout'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Invoice' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-invoices')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Invoice" back={{ href: '/money/invoices', label: 'Invoices' }} />
        <AccessDenied ctx={ctx} permissionKey="see-invoices" />
      </>
    )
  }

  const { id } = await params
  const [invoice, discountSettings] = await Promise.all([
    getInvoiceById(id),
    getDiscountSettings(),
  ])

  if (!invoice) notFound()

  return (
    <>
      <WorkspaceHeader
        workspaceKey="money"
        title={invoice.invoiceNumber || `${invoice.studentFirstName} ${invoice.studentLastName}`}
        back={{ href: '/money/invoices', label: 'Invoices' }}
      />

      <InvoiceDetailLayout
        invoice={invoice}
        discountSettings={discountSettings ?? mergeDiscountSettings('', undefined)}
        autoApproveThreshold={discountSettings?.approval.thresholdNaira ?? null}
      />
    </>
  )
}
