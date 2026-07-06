import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import InvoicePDF from '@/components/invoices/InvoicePDF'
import { getInvoiceById } from '@/lib/queries/fees'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const invoice = await getInvoiceById(id)
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const logoUrl = invoice.schoolLogoUrl

  // Render to PDF buffer
  const pdfBuffer = await renderToBuffer(
    createElement(InvoicePDF, { invoice, logoUrl }) as any
  )

  // Generate a friendly filename
  const safeStudentName = `${invoice.studentFirstName}_${invoice.studentLastName}`.replace(/[^a-zA-Z0-9_]/g, '')
  const safeTermName = invoice.cycleName.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = `${safeStudentName}_${safeTermName}_invoice.pdf`

  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  })
}