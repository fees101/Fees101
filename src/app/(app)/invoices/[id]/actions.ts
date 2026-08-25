'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { sendMessageWithFallback, sendMultiChannel, EmailContent } from '@/lib/messaging/sendMessage'
import { MessageChannel } from '@/lib/messaging/types'
import { composeInvoiceSMS, composeInvoiceEmail, InvoiceMessageParams } from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'
import { getInvoiceByIdForSchool } from '@/lib/queries/fees'
import { renderInvoicePdfBuffer } from '@/lib/pdf/renderInvoicePdf'

async function getContext() {
  // Gated on the 'manage-invoices' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-invoices')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId }
}

// Renders the invoice PDF and pairs it with the email body — kept separate
// from sendInvoice so it's only ever called when there's actually a parent
// email on file (rendering a PDF isn't free).
async function buildInvoiceEmailContent(
  supabase: any,
  invoiceId: string,
  schoolId: string,
  params: InvoiceMessageParams
): Promise<EmailContent> {
  const invoiceDetail = await getInvoiceByIdForSchool(supabase, schoolId, invoiceId)
  const email = composeInvoiceEmail({ ...params, logoUrl: invoiceDetail?.schoolLogoUrl })
  const pdfBuffer = invoiceDetail
    ? await renderInvoicePdfBuffer(invoiceDetail, invoiceDetail.schoolLogoUrl)
    : null
  return {
    ...email,
    attachments: pdfBuffer
      ? [{ filename: 'invoice.pdf', content: pdfBuffer, contentType: 'application/pdf' }]
      : undefined,
  }
}

export async function sendInvoice(invoiceId: string, channelOverride?: MessageChannel) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: inv } = await supabase
    .from('invoices')
    .select(`
      id, total_amount, paid_amount, outstanding_amount, status,
      students!inner(id, first_name, last_name, provider_dva_account_number, provider_dva_bank_name,
        families(primary_parent_name, primary_parent_phone, primary_parent_email)),
      billing_cycles!inner(name, due_date)
    `)
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!inv) return { error: 'Invoice not found' }
  if (inv.status === 'cancelled') return { error: 'This invoice is cancelled.' }

  const student: any = inv.students
  const family: any = student?.families
  const parentName: string | undefined = family?.primary_parent_name
  const parentPhone: string | undefined = family?.primary_parent_phone
  const parentEmail: string | undefined = family?.primary_parent_email
  if (!parentPhone && !parentEmail) return { error: 'No parent phone number or email on file for this student.' }
  if (!student.provider_dva_account_number || !student.provider_dva_bank_name) {
    return { error: 'No payment account provisioned for this student yet.' }
  }
  const dueDate: string | undefined = (inv.billing_cycles as any)?.due_date
  if (!dueDate) return { error: 'This billing cycle has no due date set.' }

  const { data: school } = await supabase.from('schools').select('name, settings').eq('id', schoolId).single()

  const outstanding = Number(
    inv.outstanding_amount ?? (Number(inv.total_amount) - Number(inv.paid_amount || 0))
  )

  const messageParams = {
    studentName: `${student.first_name} ${student.last_name}`.trim(),
    parentName,
    termName: (inv.billing_cycles as any)?.name || '',
    amountDue: outstanding,
    accountNumber: student.provider_dva_account_number,
    bankName: student.provider_dva_bank_name,
    dueDate,
  }
  const smsText = composeInvoiceSMS({ ...messageParams, schoolName: getSchoolSmsName(school) })

  // Email carries the actual invoice PDF (an SMS can't), so it's only built
  // when there's an address to send it to — rendering a PDF is not free.
  let emailContent: EmailContent | undefined
  if (parentEmail) {
    emailContent = await buildInvoiceEmailContent(supabase, invoiceId, schoolId, { ...messageParams, schoolName: school?.name || '' })
  }

  const send = channelOverride
    ? sendMessageWithFallback(
        { supabase, schoolId, messageType: 'invoice', studentId: student.id, invoiceId },
        { phone: parentPhone, email: parentEmail },
        { sms: smsText, email: emailContent },
        { channelOrder: [channelOverride] }
      )
    : sendMultiChannel(
        { supabase, schoolId, messageType: 'invoice', studentId: student.id, invoiceId },
        { phone: parentPhone, email: parentEmail },
        { sms: smsText, email: emailContent }
      )
  const result = await send

  if (!result.ok) return { error: 'Failed to send on every available channel — check the notification banner for details.' }

  // Light the dormant "sent" machinery: mark sent, clear the resend flag.
  await supabase
    .from('invoices')
    .update({ sent_at: new Date().toISOString(), needs_resend: false })
    .eq('id', invoiceId)
    .eq('school_id', schoolId)

  revalidatePath(`/invoices/${invoiceId}`)
  return {
    success: true,
    channelsUsed: result.attempts.filter((a) => a.ok).map((a) => a.channel),
    to: [parentPhone, parentEmail].filter(Boolean).join(' / '),
    preview: smsText,
  }
}
