// Applies a verified incoming payment across a student's outstanding
// invoices, oldest term first, spilling any remainder into credit_balance.
// Called only after the webhook processor has already claimed the
// transaction in processed_provider_transactions — this function assumes
// it will run exactly once per real-world transaction.

import { sendMultiChannel } from '@/lib/messaging/sendMessage'
import { composePartialPaymentSMS, composeFullPaymentSMS, composeFullPaymentEmail } from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'
import { getInvoiceByIdForSchool } from '@/lib/queries/fees'
import { renderInvoicePdfBuffer } from '@/lib/pdf/renderInvoicePdf'

// Above this, a webhook amount is still applied in full (a school can
// legitimately collect a whole year's fees in one transfer) but flagged for
// a human to glance at — see ROADMAP.md's "no sanity cap on webhook payment
// amounts" finding (2026-09-16).
const SUSPICIOUS_PAYMENT_THRESHOLD = 5_000_000

interface ApplyPaymentParams {
  supabase: any
  schoolId: string
  studentId: string
  amountPaid: number
  settlementAmount: number
  provider: string
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

export async function applyProviderPayment(
  params: ApplyPaymentParams
): Promise<{ paymentIds: string[]; appliedInvoices: AppliedInvoicePayment[]; creditBalanceAmount: number }> {
  const {
    supabase, schoolId, studentId, amountPaid, settlementAmount,
    provider, providerReference, providerTransactionId, paidAt,
  } = params

  // A non-positive amount used to fall through to an empty candidate loop
  // and a silent no-op (webhook still 200s, nothing recorded or flagged) —
  // reject it explicitly so a malformed/adversarial payload surfaces as an
  // error the caller logs, instead of vanishing.
  if (!(amountPaid > 0)) {
    throw new Error(`Rejected non-positive payment amount (${amountPaid}) for student ${studentId}`)
  }

  // Best-effort anomaly flag — never blocks a legitimate large payment.
  if (amountPaid >= SUSPICIOUS_PAYMENT_THRESHOLD) {
    try {
      await supabase.from('admin_notifications').insert({
        school_id: schoolId,
        type: 'suspicious_payment_amount',
        title: 'Unusually large payment received',
        body: `A ${provider} payment of ₦${amountPaid.toLocaleString()} was received and applied ` +
          `(reference ${providerReference}). Confirm this matches what was expected.`,
      })
    } catch {
      // notification is informational only — a failed insert must never break payment processing
    }
  }

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

    // Locks the invoice row and re-decides how much is actually still owed
    // before applying anything, so a concurrent call for the same invoice
    // (e.g. two distinct legitimate webhook deliveries landing near-
    // simultaneously) can never both apply against a stale outstanding
    // read — see ROADMAP.md's double-spend race finding (2026-09-16).
    // Requires db/atomic_payment_application.sql to be run in Supabase.
    const { data: applyResult, error } = await supabase
      .rpc('apply_payment_to_invoice', {
        p_invoice_id: invoice.id,
        p_school_id: schoolId,
        p_student_id: studentId,
        p_amount_available: remaining,
        p_method: 'provider_dva',
        p_provider: provider,
        p_provider_reference: providerReference,
        p_provider_transaction_id: providerTransactionId,
        p_paid_at: paidAt,
        p_notes: notes, // cryptographically verified — no manual review needed
      })
      .single()

    if (error) throw new Error(`Failed to apply payment to invoice ${invoice.id}: ${error.message}`)

    const applyAmount = Number(applyResult.amount_applied)
    if (applyAmount <= 0) continue

    paymentIds.push(applyResult.payment_id)
    remaining -= applyAmount

    const newOutstanding = Number(applyResult.new_outstanding)
    const isFull = applyResult.new_status === 'paid' || newOutstanding <= 0
    appliedInvoices.push({
      invoiceId: invoice.id,
      paymentId: applyResult.payment_id,
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
  // Inserting the payment row and crediting the balance happen in one DB
  // transaction (insert_credit_balance_payment) — otherwise a crash between
  // the two would leave real money recorded as received with nothing
  // reflected on the student's account, and nothing would ever revisit it.
  if (remaining > 0) {
    const { data: creditPaymentId, error } = await supabase.rpc('insert_credit_balance_payment', {
      p_school_id: schoolId,
      p_student_id: studentId,
      p_amount: remaining,
      p_method: 'provider_dva',
      p_provider: provider,
      p_provider_reference: providerReference,
      p_provider_transaction_id: providerTransactionId,
      p_paid_at: paidAt,
      p_notes: `${notes}; overpayment applied to student credit balance`,
    })

    if (error) throw new Error(`Failed to record credit-balance payment: ${error.message}`)
    paymentIds.push(creditPaymentId)
    creditBalanceAmount = remaining
  }

  return { paymentIds, appliedInvoices, creditBalanceAmount }
}
