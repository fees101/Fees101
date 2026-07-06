import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, Document } from '@react-pdf/renderer'
import { createElement } from 'react'
import { InvoicePage } from '@/components/InvoicePDF'
import { getInvoicesByCycleId } from '@/lib/queries/fees'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const invoices = await getInvoicesByCycleId(id)
  if (!invoices || invoices.length === 0) {
    return NextResponse.json({ error: 'No invoices found for this term' }, { status: 404 })
  }

  const logoUrl = invoices[0].schoolLogoUrl

  // Build combined Document with one Page per invoice
  const combinedDoc = createElement(
    Document,
    {},
    ...invoices.map((invoice) =>
      createElement(InvoicePage, {
        invoice,
        logoUrl,
        key: invoice.id,
      })
    )
  )

  const pdfBuffer = await renderToBuffer(combinedDoc as any)

  const safeTermName = invoices[0].cycleName.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = `${safeTermName}_all_invoices.pdf`

  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}