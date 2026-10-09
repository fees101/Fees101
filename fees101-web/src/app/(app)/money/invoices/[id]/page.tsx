import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getInvoiceById } from '@/lib/queries/fees'
import { getDiscountSettings, mergeDiscountSettings } from '@/lib/queries/discounts'
import InvoiceDetailLayout from '@/components/invoices/InvoiceDetailLayout'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getRefundsFeatureState } from '@/lib/queries/refunds'
import { getIncomingCreditTransfers } from '@/lib/queries/students'

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
  const [invoice, discountSettings, refundsFeature] = await Promise.all([
    getInvoiceById(id),
    getDiscountSettings(),
    getRefundsFeatureState(),
  ])

  if (!invoice) notFound()

  const incomingCreditTransfers = await getIncomingCreditTransfers(invoice.studentId)

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
        canRequestRefund={can(ctx, 'request-refunds') && refundsFeature.liabilityAccepted}
        incomingCreditTransfers={incomingCreditTransfers}
      />
    </>
  )
}
