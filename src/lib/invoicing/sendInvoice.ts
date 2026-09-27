// Core per-invoice send logic, shared by the single-invoice action
// (src/app/(app)/money/invoices/[id]/actions.ts) and the bulk_send background-job
// chunk processor below. No permission check here — callers are expected to
// have already checked (mirrors provisionStudentDVA vs. its wrapping actions
// in src/lib/payments/provisionDVA.ts) since a service-role-driven job worker
// can't run a session-based permission check itself.

import { sendMessageWithFallback, sendMultiChannel, EmailContent } from '@/lib/messaging/sendMessage'
import { MessageChannel } from '@/lib/messaging/types'
import {
  composeInvoiceSMS, composeInvoiceEmail, InvoiceMessageParams,
  composeFamilyInvoiceSMS, composeFamilyInvoiceEmail, FamilyInvoiceChild,
} from '@/lib/messaging/composeInvoice'
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
  const email = composeInvoiceEmail({
    ...params,
    logoUrl: invoiceDetail?.schoolLogoUrl,
    className: invoiceDetail?.className || undefined,
    lineItems: invoiceDetail?.lineItems,
  })
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
      billing_cycles!inner(name, due_date, status)
    `)
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!inv) return { error: 'Invoice not found' }
  if (inv.status === 'cancelled') return { error: 'This invoice is cancelled.' }

  // A closed term's invoice is only a dead end when its balance actually made
  // it onto a newer invoice — a student who withdrew/graduated (or wasn't
  // re-enrolled) before the next term's invoices were generated has no
  // successor, so this old invoice remains the only real record of what's
  // owed and must stay sendable.
  if ((inv.billing_cycles as any)?.status === 'closed') {
    const { data: successor } = await supabase
      .from('invoices')
      .select('id, billing_cycles(name)')
      .eq('previous_balance_from_invoice_id', invoiceId)
      .eq('school_id', schoolId)
      .maybeSingle()
    if (successor) {
      const successorCycleName = (successor.billing_cycles as any)?.name
      return {
        error: `This term is closed — the balance carried forward to ${successorCycleName ? `the ${successorCycleName} invoice` : 'a newer invoice'} automatically, so send that one instead.`,
      }
    }
  }

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
  createdBy: string,
  opts: { onlyNeedsResend?: boolean } = {}
): Promise<{ error: string } | { jobId: string | null; total: number; processed: number }> {
  // needs_resend bypasses the outstanding-balance gate: a parent needs to hear
  // about a changed invoice even if it nets to a zero balance now (e.g. it was
  // fully paid, then the fee items changed) — the notification is about the
  // change itself, not about money still owed.
  let query = supabase
    .from('invoices')
    .select('id, billing_cycles!inner(status), students!inner(family_id)')
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
  query = opts.onlyNeedsResend
    ? query.eq('needs_resend', true)
    : query.or('and(sent_at.is.null,outstanding_amount.gt.0),needs_resend.eq.true')
  const { data: allInvoices, error } = await query

  if (error) return { error: error.message }

  // A closed-term invoice is a dead end only if its balance already carried
  // forward to a successor invoice — otherwise (graduated/withdrawn student,
  // no successor) it's still the live record and belongs in the sweep.
  const closedInvoiceIds = (allInvoices || [])
    .filter((i: any) => i.billing_cycles?.status === 'closed')
    .map((i: any) => i.id)
  let supersededIds = new Set<string>()
  if (closedInvoiceIds.length > 0) {
    const { data: successors } = await supabase
      .from('invoices')
      .select('previous_balance_from_invoice_id')
      .eq('school_id', schoolId)
      .in('previous_balance_from_invoice_id', closedInvoiceIds)
    supersededIds = new Set((successors || []).map((s: any) => s.previous_balance_from_invoice_id))
  }
  const invoices = (allInvoices || []).filter((i: any) =>
    i.billing_cycles?.status !== 'closed' || !supersededIds.has(i.id)
  )

  // Sorted by family so siblings always land in the same CHUNK_SIZE slice —
  // otherwise a family's invoices could straddle a chunk boundary and never
  // get consolidated into one message (groupInvoicesForSending only sees one
  // chunk's worth of invoiceIds at a time). Invoices with no family (or a
  // family not on this term's DVA) keep their relative order after sorting,
  // since a stable sort only moves same-family invoices next to each other.
  const sortedInvoices = [...invoices].sort((a: any, b: any) => {
    const familyA = a.students?.family_id || ''
    const familyB = b.students?.family_id || ''
    return familyA.localeCompare(familyB)
  })

  const invoiceIds = sortedInvoices.map((i: any) => i.id)

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

export interface FamilyInvoiceGroup {
  familyId: string
  billingCycleId: string
  invoiceIds: string[]
}

export interface GroupedInvoicesForSending {
  familyGroups: FamilyInvoiceGroup[]
  singleInvoiceIds: string[]
}

// Partitions a chunk's invoiceIds into family-consolidatable groups (same
// family + same billing cycle, family DVA enabled and provisioned, 2+
// siblings touched in this chunk) vs. everything else, which still goes
// through the existing one-invoice-at-a-time path. This only decides how the
// *notification* for an already-generated invoice gets bundled — invoice
// generation itself stays per-child, untouched.
export async function groupInvoicesForSending(
  supabase: any,
  schoolId: string,
  invoiceIds: string[]
): Promise<GroupedInvoicesForSending> {
  if (invoiceIds.length === 0) return { familyGroups: [], singleInvoiceIds: [] }

  const { data: rows } = await supabase
    .from('invoices')
    .select('id, billing_cycle_id, students!inner(family_id, families(dva_enabled, provider_dva_account_number, provider_dva_bank_name))')
    .in('id', invoiceIds)
    .eq('school_id', schoolId)

  const byKey = new Map<string, FamilyInvoiceGroup>()
  const singleInvoiceIds: string[] = []

  for (const row of rows || []) {
    const student: any = row.students
    const family: any = student?.families
    const familyId: string | undefined = student?.family_id
    const qualifies =
      familyId && family?.dva_enabled && family?.provider_dva_account_number && family?.provider_dva_bank_name

    if (!qualifies) {
      singleInvoiceIds.push(row.id)
      continue
    }
    const key = `${familyId}:${row.billing_cycle_id}`
    const existing = byKey.get(key)
    if (existing) {
      existing.invoiceIds.push(row.id)
    } else {
      byKey.set(key, { familyId, billingCycleId: row.billing_cycle_id, invoiceIds: [row.id] })
    }
  }

  const familyGroups: FamilyInvoiceGroup[] = []
  for (const group of byKey.values()) {
    // A lone child touched this round doesn't need "family framing" — falls
    // back to the plain per-child send, same as a family with DVA off.
    if (group.invoiceIds.length >= 2) {
      familyGroups.push(group)
    } else {
      singleInvoiceIds.push(...group.invoiceIds)
    }
  }

  return { familyGroups, singleInvoiceIds }
}

export interface SendFamilyInvoiceCoreResult {
  success: true
  channelsUsed: MessageChannel[]
  to: string
  preview: string
  invoiceIds: string[]
}

// One message covering every sibling's invoice in this family+cycle group —
// same reasoning as applyPayment.ts's family-payment consolidation, applied
// to the invoice side. Each child still gets their own invoice PDF attached
// individually (never a combined document) and their own account listed, so
// a parent who wants to pay per-child still can — the family account is
// offered as an additional way to pay everyone at once, not a replacement.
export async function sendFamilyInvoiceCore(
  supabase: any,
  schoolId: string,
  invoiceIds: string[]
): Promise<{ error: string } | SendFamilyInvoiceCoreResult> {
  const { data: invs } = await supabase
    .from('invoices')
    .select(`
      id, total_amount, paid_amount, outstanding_amount, status, credit_applied,
      students!inner(id, first_name, last_name, family_id, provider_dva_account_number, provider_dva_bank_name,
        families!inner(primary_parent_name, primary_parent_phone, primary_parent_email,
          provider_dva_account_number, provider_dva_bank_name)),
      billing_cycles!inner(name, due_date, status)
    `)
    .in('id', invoiceIds)
    .eq('school_id', schoolId)

  const rows = (invs || []).filter((inv: any) => inv.status !== 'cancelled')
  if (rows.length === 0) return { error: 'No sendable invoices in this family group.' }

  const first: any = rows[0]
  const family: any = first.students?.families
  const parentName: string | undefined = family?.primary_parent_name
  const parentPhone: string | undefined = family?.primary_parent_phone
  const parentEmail: string | undefined = family?.primary_parent_email
  if (!parentPhone && !parentEmail) return { error: 'No parent phone number or email on file for this family.' }
  if (!family?.provider_dva_account_number || !family?.provider_dva_bank_name) {
    return { error: 'No family payment account provisioned yet.' }
  }
  const dueDate: string | undefined = (first.billing_cycles as any)?.due_date
  if (!dueDate) return { error: 'This billing cycle has no due date set.' }

  const { data: school } = await supabase.from('schools').select('name, settings').eq('id', schoolId).single()
  const termName = (first.billing_cycles as any)?.name || ''

  const children: FamilyInvoiceChild[] = []
  const attachments: { filename: string; content: Buffer; contentType: string }[] = []

  for (const inv of rows) {
    const student: any = inv.students
    if (!student.provider_dva_account_number || !student.provider_dva_bank_name) continue

    const outstanding = Number(inv.outstanding_amount ?? (Number(inv.total_amount) - Number(inv.paid_amount || 0)))
    const invoiceDetail = await getInvoiceByIdForSchool(supabase, schoolId, inv.id)

    children.push({
      studentName: `${student.first_name} ${student.last_name}`.trim(),
      className: invoiceDetail?.className || undefined,
      amountDue: outstanding,
      accountNumber: student.provider_dva_account_number,
      bankName: student.provider_dva_bank_name,
    })

    if (parentEmail) {
      const pdfBuffer = invoiceDetail
        ? await renderInvoicePdfBuffer(invoiceDetail, invoiceDetail.schoolLogoUrl)
        : null
      if (pdfBuffer) {
        attachments.push({
          filename: `invoice-${student.first_name.trim().split(/\s+/)[0].toLowerCase()}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        })
      }
    }
  }

  if (children.length === 0) return { error: 'None of these students have a payment account provisioned yet.' }

  const smsText = composeFamilyInvoiceSMS({
    parentName,
    schoolName: getSchoolSmsName(school),
    termName,
    dueDate,
    familyAccountNumber: family.provider_dva_account_number,
    familyBankName: family.provider_dva_bank_name,
    children,
  })

  let emailContent: EmailContent | undefined
  if (parentEmail) {
    const email = composeFamilyInvoiceEmail({
      parentName,
      schoolName: school?.name || '',
      termName,
      dueDate,
      familyAccountNumber: family.provider_dva_account_number,
      familyBankName: family.provider_dva_bank_name,
      children,
    })
    emailContent = { ...email, attachments: attachments.length > 0 ? attachments : undefined }
  }

  const result = await sendMultiChannel(
    { supabase, schoolId, messageType: 'invoice', studentId: first.students.id },
    { phone: parentPhone, email: parentEmail },
    { sms: smsText, email: emailContent }
  )

  if (!result.ok) return { error: 'Failed to send on every available channel — check the notification banner for details.' }

  const sentInvoiceIds = rows.map((r: any) => r.id)
  await supabase
    .from('invoices')
    .update({ sent_at: new Date().toISOString(), needs_resend: false })
    .in('id', sentInvoiceIds)
    .eq('school_id', schoolId)

  const channelsUsed = result.attempts.filter((a) => a.ok).map((a) => a.channel)

  return {
    success: true,
    channelsUsed,
    to: [parentPhone, parentEmail].filter(Boolean).join(' / '),
    preview: smsText,
    invoiceIds: sentInvoiceIds,
  }
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

  // Resume-safety applies before grouping too: a killed run can replay this
  // exact slice, and neither send path guards against re-sending. Anything
  // already sent and not flagged for resend is dropped here so a resumed
  // slice never dispatches duplicate texts/emails — counted as sent (it is),
  // so the total stays honest across a resume.
  const { data: statusRows } = await supabase
    .from('invoices')
    .select('id, sent_at, needs_resend')
    .in('id', invoiceIds)
    .eq('school_id', schoolId)
  const alreadySentIds = new Set(
    (statusRows || []).filter((r: any) => r.sent_at && !r.needs_resend).map((r: any) => r.id)
  )
  sent += alreadySentIds.size
  const pendingIds = invoiceIds.filter((id) => !alreadySentIds.has(id))

  const { familyGroups, singleInvoiceIds } = await groupInvoicesForSending(supabase, schoolId, pendingIds)

  for (const group of familyGroups) {
    const result = await sendFamilyInvoiceCore(supabase, schoolId, group.invoiceIds)
    if ('error' in result) {
      for (const invoiceId of group.invoiceIds) {
        failedIds.push(invoiceId)
        errorsByInvoiceId[invoiceId] = result.error
      }
    } else {
      sent += group.invoiceIds.length
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  for (const invoiceId of singleInvoiceIds) {
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
