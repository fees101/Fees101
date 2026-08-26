// Applies a verified incoming payment across a student's outstanding
// invoices, oldest term first, spilling any remainder into credit_balance.
// Called only after the webhook processor has already claimed the
// transaction in processed_provider_transactions — this function assumes
// it will run exactly once per real-world transaction.

import { applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { sendMultiChannel } from '@/lib/messaging/sendMessage'
import { composePartialPaymentSMS, composeFullPaymentSMS, composeFullPaymentEmail } from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'
import { getInvoiceByIdForSchool } from '@/lib/queries/fees'
import { renderInvoicePdfBuffer } from '@/lib/pdf/renderInvoicePdf'

interface ApplyPaymentParams {
  supabase: any
  schoolId: string
  studentId: string
  amountPaid: number
  settlementAmount: number
  providerReference: string
  providerTransactionId: string
  paidAt: string
}

export interface AppliedInvoicePayment {
  invoiceId: string
  paymentId: string
  amount: number
  oldStatus: string
  newStatus: string
}

export async function applyMonnifyPayment(
  params: ApplyPaymentParams
): Promise<{ paymentIds: string[]; appliedInvoices: AppliedInvoicePayment[]; creditBalanceAmount: number }> {
  const {
    supabase, schoolId, studentId, amountPaid, settlementAmount,
    providerReference, providerTransactionId, paidAt,
  } = params

  // Eligible invoices are any non-cancelled, outstanding invoice that hasn't
  // been superseded — i.e. no other invoice has folded its balance forward
  // via previous_balance_from_invoice_id (closeTermAndCarryForward does this
  // when a student already has a future invoice to carry the debt onto).
  // Closed-cycle status alone is NOT disqualifying: a graduate or a terminal
  // mid-term withdrawal never gets a future invoice, so their last invoice
  // stays the live record of what's owed and must remain payable indefinitely
  // — excluding by cycle status alone silently orphaned their payments into
  // credit_balance forever.
  const { data: supersedingInvoices } = await supabase
    .from('invoices')
    .select('previous_balance_from_invoice_id')
    .eq('student_id', studentId)
    .not('previous_balance_from_invoice_id', 'is', null)

  const supersededIds = new Set(
    (supersedingInvoices || []).map((inv: any) => inv.previous_balance_from_invoice_id)
  )

  const { data: candidateInvoices } = await supabase
    .from('invoices')
    .select('id, status, outstanding_amount, billing_cycles!inner(name, start_date, status)')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
    .gt('outstanding_amount', 0)

  const invoices = (candidateInvoices || []).filter((inv: any) => !supersededIds.has(inv.id))

  const sorted = [...(invoices || [])].sort((a: any, b: any) =>
    a.billing_cycles.start_date.localeCompare(b.billing_cycles.start_date)
  )

  const notes = `provider settlementAmount=${settlementAmount} (fee not deducted from what the student is credited)`
  let remaining = amountPaid
  const paymentIds: string[] = []
  const appliedInvoices: AppliedInvoicePayment[] = []

  // Payment-confirmation message is best-effort — a student/school lookup
  // miss or a delivery failure should never break payment processing itself.
  let notifyInfo: {
    phone?: string
    email?: string
    parentName?: string
    studentName: string
    schoolName: string
    schoolFullName: string
    accountNumber: string
  } | null = null
  if (sorted.length > 0) {
    const [{ data: student }, { data: school }] = await Promise.all([
      supabase
        .from('students')
        .select('first_name, last_name, provider_dva_account_number, families(primary_parent_name, primary_parent_phone, primary_parent_email)')
        .eq('id', studentId)
        .single(),
      supabase.from('schools').select('name, settings').eq('id', schoolId).single(),
    ])
    const phone = (student?.families as any)?.primary_parent_phone
    const email = (student?.families as any)?.primary_parent_email
    const parentName = (student?.families as any)?.primary_parent_name
    if ((phone || email) && student?.provider_dva_account_number) {
      notifyInfo = {
        phone,
        email,
        parentName,
        studentName: `${student.first_name} ${student.last_name}`.trim(),
        schoolName: getSchoolSmsName(school),
        schoolFullName: school?.name || '',
        accountNumber: student.provider_dva_account_number,
      }
    }
  }

  for (const invoice of sorted) {
    if (remaining <= 0) break
    const outstanding = Number(invoice.outstanding_amount)
    const applyAmount = Math.min(remaining, outstanding)
    if (applyAmount <= 0) continue

    const { data: paymentRow, error } = await supabase
      .from('payments')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        invoice_id: invoice.id,
        amount: applyAmount,
        method: 'provider_dva',
        provider: 'monnify',
        provider_reference: providerReference,
        provider_transaction_id: providerTransactionId,
        paid_at: paidAt,
        match_status: 'matched', // cryptographically verified — no manual review needed
        notes,
      })
      .select('id')
      .single()

    if (error) throw new Error(`Failed to insert payment for invoice ${invoice.id}: ${error.message}`)
    paymentIds.push(paymentRow.id)
    remaining -= applyAmount

    const newOutstanding = outstanding - applyAmount
    const isFull = newOutstanding <= 0
    appliedInvoices.push({
      invoiceId: invoice.id,
      paymentId: paymentRow.id,
      amount: applyAmount,
      oldStatus: invoice.status,
      newStatus: isFull ? 'paid' : 'partial',
    })

    if (notifyInfo) {
      const termName = (invoice.billing_cycles as any)?.name || ''
      const smsText = isFull
        ? composeFullPaymentSMS({
            studentName: notifyInfo.studentName,
            parentName: notifyInfo.parentName,
            schoolName: notifyInfo.schoolName,
            termName,
            amountPaid: applyAmount,
          })
        : composePartialPaymentSMS({
            studentName: notifyInfo.studentName,
            parentName: notifyInfo.parentName,
            schoolName: notifyInfo.schoolName,
            amountPaid: applyAmount,
            balance: newOutstanding,
            accountNumber: notifyInfo.accountNumber,
          })

      // Email carries the receipt as a PDF — reserved for full payment only.
      // A partial payment still gets an SMS, but skips the email/PDF entirely
      // to conserve the free-tier daily email quota as student volume grows;
      // the parent gets the full PDF receipt once the balance clears.
      let emailContent
      if (notifyInfo.email && isFull) {
        const invoiceDetail = await getInvoiceByIdForSchool(supabase, schoolId, invoice.id)
        const email = composeFullPaymentEmail({
          studentName: notifyInfo.studentName,
          parentName: notifyInfo.parentName,
          schoolName: notifyInfo.schoolFullName,
          termName,
          amountPaid: applyAmount,
          logoUrl: invoiceDetail?.schoolLogoUrl,
        })
        const pdfBuffer = invoiceDetail
          ? await renderInvoicePdfBuffer(invoiceDetail, invoiceDetail.schoolLogoUrl)
          : null
        emailContent = {
          ...email,
          attachments: pdfBuffer
            ? [{ filename: 'receipt.pdf', content: pdfBuffer, contentType: 'application/pdf' }]
            : undefined,
        }
      }

      await sendMultiChannel(
        { supabase, schoolId, messageType: 'receipt', studentId, invoiceId: invoice.id },
        { phone: notifyInfo.phone, email: notifyInfo.email },
        { sms: smsText, email: emailContent }
      )
    }
  }

  let creditBalanceAmount = 0

  // Nothing left owed on any open invoice — park the rest as credit rather
  // than touching a closed/frozen invoice or leaving money unaccounted for.
  if (remaining > 0) {
    const { data: creditRow, error } = await supabase
      .from('payments')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        invoice_id: null,
        amount: remaining,
        method: 'provider_dva',
        provider: 'monnify',
        provider_reference: providerReference,
        provider_transaction_id: providerTransactionId,
        paid_at: paidAt,
        match_status: 'matched',
        notes: `${notes}; overpayment applied to student credit balance`,
      })
      .select('id')
      .single()

    if (error) throw new Error(`Failed to insert credit-balance payment row: ${error.message}`)
    paymentIds.push(creditRow.id)
    creditBalanceAmount = remaining

    await applyCreditBalanceDelta(supabase, schoolId, studentId, remaining)
  }

  return { paymentIds, appliedInvoices, creditBalanceAmount }
}
