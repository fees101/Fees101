// Core per-invoice send logic, shared by the single-invoice action
// (src/app/(app)/invoices/[id]/actions.ts) and the bulk_send background-job
// chunk processor below. No permission check here — callers are expected to
// have already checked (mirrors provisionStudentDVA vs. its wrapping actions
// in src/lib/payments/provisionDVA.ts) since a service-role-driven job worker
// can't run a session-based permission check itself.

import { sendMessageWithFallback, sendMultiChannel, EmailContent } from '@/lib/messaging/sendMessage'
import { MessageChannel } from '@/lib/messaging/types'
import { composeInvoiceSMS, composeInvoiceEmail, InvoiceMessageParams } from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'
import { getInvoiceByIdForSchool } from '@/lib/queries/fees'
import { renderInvoicePdfBuffer } from '@/lib/pdf/renderInvoicePdf'
import { createJob, findRunningJob } from '@/lib/jobs/backgroundJobs'

// Renders the invoice PDF and pairs it with the email body — kept separate
// so it's only ever called when there's actually a parent email on file
// (rendering a PDF isn't free).
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

export interface SendInvoiceCoreResult {
  success: true
  channelsUsed: MessageChannel[]
  to: string
  preview: string
  studentId: string
  studentName: string
  outstanding: number
}

// Sends one invoice (SMS/email + PDF) and marks it sent. No audit logging or
// revalidation here — the single-invoice action logs its own audit event and
// revalidates its page; the bulk chunk processor below logs one summary event
// for the whole run instead of one per invoice.
export async function sendInvoiceCore(
  supabase: any,
  schoolId: string,
  invoiceId: string,
  channelOverride?: MessageChannel
): Promise<{ error: string } | SendInvoiceCoreResult> {
  const { data: inv } = await supabase
    .from('invoices')
    .select(`
      id, total_amount, paid_amount, outstanding_amount, status, sent_at, credit_applied,
      students!inner(id, first_name, last_name, provider_dva_account_number, provider_dva_bank_name, credit_balance,
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

  // A resend of an invoice already sent once before is an "update" — the
  // message calls out the credit movement so it doesn't read as a mistake.
  const isUpdate = !!inv.sent_at
  const messageParams = {
    studentName: `${student.first_name} ${student.last_name}`.trim(),
    parentName,
    termName: (inv.billing_cycles as any)?.name || '',
    amountDue: outstanding,
    accountNumber: student.provider_dva_account_number,
    bankName: student.provider_dva_bank_name,
    dueDate,
    isUpdate,
    creditApplied: Number(inv.credit_applied || 0),
    creditBalance: Number(student.credit_balance || 0),
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

  const channelsUsed = result.attempts.filter((a) => a.ok).map((a) => a.channel)

  return {
    success: true,
    channelsUsed,
    to: [parentPhone, parentEmail].filter(Boolean).join(' / '),
    preview: smsText,
    studentId: student.id,
    studentName: messageParams.studentName,
    outstanding,
  }
}

// Starts (or finds the already-running) bulk_send job for a school. Snapshots
// every invoice that's never been sent or was flagged needs_resend into the
// job's cursor at creation time — a fixed checklist consumed a chunk at a
// time, the same pattern as bulk_dva's studentIds cursor — so a persistently
// failing invoice gets crossed off and reported instead of keeping
// "remaining > 0" forever (the bug in the old client-driven while(true) loop).
export async function startBulkSendInvoicesJob(
  supabase: any,
  schoolId: string,
  createdBy: string
): Promise<{ error: string } | { jobId: string | null; total: number; processed: number }> {
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id')
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
    .gt('outstanding_amount', 0)
    .or('sent_at.is.null,needs_resend.eq.true')

  if (error) return { error: error.message }
  const invoiceIds = (invoices || []).map((i: any) => i.id)

  if (invoiceIds.length === 0) return { jobId: null, total: 0, processed: 0 }

  const existingJob = await findRunningJob(schoolId, 'bulk_send')
  if (existingJob) {
    return { jobId: existingJob.id, total: existingJob.total, processed: existingJob.processed }
  }

  const job = await createJob({
    schoolId,
    jobType: 'bulk_send',
    payload: {},
    total: invoiceIds.length,
    createdBy,
    cursor: { invoiceIds },
  })
  return { jobId: job.id, total: invoiceIds.length, processed: 0 }
}

export interface BulkSendChunkResult {
  sent: number
  failed: number
  failures: { label: string; error: string }[]
}

// One batch of the bulk-send loop, driven by advanceBulkSend (advanceJob.ts)
// and the daily sweep. Removes each invoice from the cursor whether or not it
// succeeds, so a stuck invoice is crossed off and reported instead of
// wedging the job. A short stagger between sends keeps the bonus PDF emails
// from slamming the school's mailbox all at once, same as the old loop.
export async function processBulkSendChunk(
  supabase: any,
  schoolId: string,
  invoiceIds: string[]
): Promise<BulkSendChunkResult> {
  let sent = 0
  const failedIds: string[] = []
  const errorsByInvoiceId: Record<string, string> = {}

  for (const invoiceId of invoiceIds) {
    // Resume-safety: this job's cursor can replay a slice after a mid-chunk
    // kill (function timeout/crash before updateJobProgress advanced it), and
    // sendInvoiceCore does NOT guard against re-sending (the single-invoice
    // "resend" button deliberately relies on that). So re-read fresh here and
    // skip anything already sent and not flagged for resend — otherwise a
    // resumed slice would dispatch duplicate texts/emails for invoices already
    // sent in the killed run. Count it as sent (it is), so the total stays
    // honest across a resume.
    const { data: cur } = await supabase
      .from('invoices')
      .select('sent_at, needs_resend')
      .eq('id', invoiceId)
      .eq('school_id', schoolId)
      .maybeSingle()
    if (cur && cur.sent_at && !cur.needs_resend) {
      sent++
      continue
    }

    const result = await sendInvoiceCore(supabase, schoolId, invoiceId)
    if ('error' in result) {
      failedIds.push(invoiceId)
      errorsByInvoiceId[invoiceId] = result.error
    } else {
      sent++
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  // Look up student names for the failed invoices so the modal can show
  // "who" rather than a bare invoice id — best-effort, falls back to the id
  // if an invoice vanished (already covered by its own error message).
  const labelsById: Record<string, string> = {}
  if (failedIds.length > 0) {
    const { data: invs } = await supabase
      .from('invoices')
      .select('id, students(first_name, last_name)')
      .in('id', failedIds)
    for (const inv of invs || []) {
      const student: any = inv.students
      labelsById[inv.id] = student ? `${student.first_name} ${student.last_name}`.trim() : inv.id
    }
  }

  const failures = failedIds.map((id) => ({ label: labelsById[id] || id, error: errorsByInvoiceId[id] }))

  return { sent, failed: failures.length, failures }
}
