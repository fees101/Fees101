import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import InvoicePDF from '@/components/invoices/InvoicePDF'
import { InvoiceDetail } from '@/lib/queries/fees'

// Shared by the on-demand PDF download route and the invoice/receipt email
// senders (sendInvoice, applyMonnifyPayment) — one place rendering the same
// document either way, since a receipt is just this invoice's PDF snapshot
// once its paid/outstanding amounts reflect the payment that triggered it.
export async function renderInvoicePdfBuffer(invoice: InvoiceDetail, logoUrl?: string | null): Promise<Buffer> {
  return renderToBuffer(createElement(InvoicePDF, { invoice, logoUrl }) as any)
}
