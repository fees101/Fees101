// Manual, on-demand receipt send for a fully-paid invoice — reuses the same
// full-payment message composition the auto-receipt (fired at payment time,
// src/lib/payments/applyPayment.ts) already uses, so the two receipts read
// identically. Only meaningful for invoices with outstanding_amount <= 0;
// callers should branch to sendInvoiceCore instead for anything still owing.

import { sendMultiChannel } from '@/lib/messaging/sendMessage'
import { MessageChannel } from '@/lib/messaging/types'
import { composeFullPaymentSMS, composeFullPaymentEmail, EmailBody } from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'
import { getInvoiceByIdForSchool } from '@/lib/queries/fees'
import { renderReceiptPdfBuffer } from '@/lib/pdf/renderReceiptPdf'

export interface SendReceiptCoreResult {
  success: true
  channelsUsed: MessageChannel[]
  to: string
  preview: string
}

export async function sendReceiptCore(
  supabase: any,
  schoolId: string,
  invoiceId: string
): Promise<{ error: string } | SendReceiptCoreResult> {
  const { data: inv } = await supabase
    .from('invoices')
    .select(`
      id, total_amount, paid_amount, outstanding_amount, status,
      students!inner(id, first_name, last_name, provider_dva_account_number,
        families(primary_parent_name, primary_parent_phone, primary_parent_email)),
      billing_cycles!inner(name)
    `)
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!inv) return { error: 'Invoice not found' }
  if (inv.status === 'cancelled') return { error: 'This invoice is cancelled.' }
  if (Number(inv.outstanding_amount) > 0) {
    return { error: 'This invoice still has a balance outstanding — send the invoice instead of a receipt.' }
  }

  const student: any = inv.students
  const family: any = student?.families
  const parentName: string | undefined = family?.primary_parent_name
  const parentPhone: string | undefined = family?.primary_parent_phone
  const parentEmail: string | undefined = family?.primary_parent_email
  if (!parentPhone && !parentEmail) return { error: 'No parent phone number or email on file for this student.' }

  const { data: school } = await supabase.from('schools').select('name, settings').eq('id', schoolId).single()

  const studentName = `${student.first_name} ${student.last_name}`.trim()
  const termName: string = (inv.billing_cycles as any)?.name || ''
  const amountPaid = Number(inv.paid_amount || 0)

  const smsText = composeFullPaymentSMS({
    studentName,
    parentName,
    schoolName: getSchoolSmsName(school),
    termName,
    amountPaid,
  })

  let emailContent: EmailBody & { attachments?: { filename: string; content: Buffer; contentType: string }[] } | undefined
  if (parentEmail) {
    const [invoiceDetail, { data: latestPayment }] = await Promise.all([
      getInvoiceByIdForSchool(supabase, schoolId, invoiceId),
      supabase
        .from('payments')
        .select('id, paid_at, provider_reference')
        .eq('invoice_id', invoiceId)
        .eq('match_status', 'matched')
        .order('paid_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const email = composeFullPaymentEmail({
      studentName,
      parentName,
      schoolName: school?.name || '',
      termName,
      amountPaid,
      logoUrl: invoiceDetail?.schoolLogoUrl,
      paidAt: latestPayment?.paid_at || undefined,
      accountNumber: student.provider_dva_account_number || undefined,
      reference: latestPayment?.provider_reference || latestPayment?.id || undefined,
    })
    const pdfBuffer = invoiceDetail
      ? await renderReceiptPdfBuffer(invoiceDetail, invoiceDetail.schoolLogoUrl, latestPayment?.id)
      : null
    emailContent = {
      ...email,
      attachments: pdfBuffer
        ? [{ filename: 'receipt.pdf', content: pdfBuffer, contentType: 'application/pdf' }]
        : undefined,
    }
  }

  const result = await sendMultiChannel(
    { supabase, schoolId, messageType: 'receipt', studentId: student.id, invoiceId },
    { phone: parentPhone, email: parentEmail },
    { sms: smsText, email: emailContent }
  )

  if (!result.ok) return { error: 'Failed to send on every available channel — check the notification banner for details.' }

  const channelsUsed = result.attempts.filter((a) => a.ok).map((a) => a.channel)

  return {
    success: true,
    channelsUsed,
    to: [parentPhone, parentEmail].filter(Boolean).join(' / '),
    preview: smsText,
  }
}
