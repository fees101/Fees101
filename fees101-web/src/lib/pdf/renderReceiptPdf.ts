import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import ReceiptPDF from '@/components/invoices/ReceiptPDF'
import { InvoiceDetail } from '@/lib/queries/fees'

// Renders the receipt artefact (ReceiptPDF.tsx) for a single payment on an
// invoice. `highlightPaymentId` selects which payment the receipt confirms;
// omitted, it defaults to the invoice's most recent payment.
export async function renderReceiptPdfBuffer(
  invoice: InvoiceDetail,
  logoUrl?: string | null,
  highlightPaymentId?: string
): Promise<Buffer> {
  return renderToBuffer(createElement(ReceiptPDF, { invoice, logoUrl, highlightPaymentId }) as any)
}
