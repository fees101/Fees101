import { NextRequest, NextResponse } from 'next/server'
import { renderInvoicePdfBuffer } from '@/lib/pdf/renderInvoicePdf'
import { getInvoiceById } from '@/lib/queries/fees'
import { requirePermission } from '@/lib/auth/permissions'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requirePermission('see-invoices')
  if (!ctx) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const { id } = await params

  const invoice = await getInvoiceById(id)
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const logoUrl = invoice.schoolLogoUrl

  const pdfBuffer = await renderInvoicePdfBuffer(invoice, logoUrl)

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