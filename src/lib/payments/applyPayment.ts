// Applies a verified incoming payment across a student's (or, for a family
// DVA, every sibling's) outstanding invoices, oldest term first, spilling
// any remainder into credit_balance. Called only after the webhook processor
// has already claimed the transaction in processed_provider_transactions —
// this function assumes it will run exactly once per real-world transaction.

import { sendMultiChannel } from '@/lib/messaging/sendMessage'
import {
  composePartialPaymentSMS, composeFullPaymentSMS, composeFullPaymentEmail,
  composeFamilyPaymentSMS, composeFamilyPaymentEmail, FamilyPaymentChildResult,
  composeCreditReceiptSMS, composeCreditReceiptEmail,
} from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'
import { getInvoiceByIdForSchool } from '@/lib/queries/fees'
import { renderReceiptPdfBuffer } from '@/lib/pdf/renderReceiptPdf'

// Above this, a webhook amount is still applied in full (a school can
// legitimately collect a whole year's fees in one transfer) but flagged for
// a human to glance at — see ROADMAP.md's "no sanity cap on webhook payment
// amounts" finding (2026-09-16).
const SUSPICIOUS_PAYMENT_THRESHOLD = 5_000_000

interface ApplyPaymentParams {
  supabase: any
  schoolId: string
  // Exactly one of these. studentId is the existing per-student DVA path;
  // familyId (ROADMAP.md Phase 3/4, 2026-09-27) widens the same waterfall
  // across every active sibling's open invoices instead of just one student.
  studentId?: string
  familyId?: string
  amountPaid: number
  settlementAmount: number
  provider: string
  providerReference: string
  providerTransactionId: string
  paidAt: string
}

// Looks up which owner (a single student, or a family) a provider's
// customer/account reference belongs to. Shared by both webhook processors
// so a family DVA is recognized the same way on Paystack and Monnify —
// tried second, after the existing per-student match, since almost every
// reference is still a student's.
export async function resolveDvaOwner(
  supabase: any,
  schoolId: string,
  providerReference: string
): Promise<{ studentId: string } | { familyId: string } | null> {
  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('provider_dva_reference', providerReference)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (student) return { studentId: student.id }

  const { data: family } = await supabase
    .from('families')
    .select('id')
    .eq('provider_dva_reference', providerReference)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (family) return { familyId: family.id }

  return null
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
    supabase, schoolId, studentId, familyId, amountPaid, settlementAmount,
    provider, providerReference, providerTransactionId, paidAt,
  } = params

  if ((studentId && familyId) || (!studentId && !familyId)) {
    throw new Error('applyProviderPayment requires exactly one of studentId or familyId')
  }

  // A non-positive amount used to fall through to an empty candidate loop
  // and a silent no-op (webhook still 200s, nothing recorded or flagged) —
  // reject it explicitly so a malformed/adversarial payload surfaces as an
  // error the caller logs, instead of vanishing.
  if (!(amountPaid > 0)) {
    throw new Error(`Rejected non-positive payment amount (${amountPaid}) for ${studentId ? `student ${studentId}` : `family ${familyId}`}`)
  }

  // A family DVA payment fans out across every active sibling's invoices —
  // resolved once up front, everything below just works against this list
  // the same way it always worked against a single studentId.
  let studentIds: string[]
  if (studentId) {
    studentIds = [studentId]
  } else {
    const { data: siblings, error: siblingsError } = await supabase
      .from('students')
      .select('id')
      .eq('family_id', familyId)
      .eq('school_id', schoolId)
      .eq('status', 'active')

    if (siblingsError) throw new Error(`Failed to resolve family's students: ${siblingsError.message}`)
    studentIds = (siblings || []).map((s: any) => s.id)
    if (studentIds.length === 0) {
      throw new Error(`Family ${familyId} has no active students to apply a payment to`)
    }
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
    .in('student_id', studentIds)
    .not('previous_balance_from_invoice_id', 'is', null)

  const supersededIds = new Set(
    (supersedingInvoices || []).map((inv: any) => inv.previous_balance_from_invoice_id)
  )

  const { data: candidateInvoices } = await supabase
    .from('invoices')
    .select('id, student_id, status, outstanding_amount, billing_cycles!inner(name, start_date, status, due_date)')
    .in('student_id', studentIds)
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
    .gt('outstanding_amount', 0)

  const invoices = (candidateInvoices || []).filter((inv: any) => !supersededIds.has(inv.id))

  // Oldest cycle first, across every sibling when this is a family payment —
  // the same single waterfall, just widened to run over the whole family's
  // open invoices in one pass instead of one student's.
  const sorted = [...(invoices || [])].sort((a: any, b: any) =>
    a.billing_cycles.start_date.localeCompare(b.billing_cycles.start_date)
  )

  const notes = `provider settlementAmount=${settlementAmount} (fee not deducted from what the student is credited)`
  let remaining = amountPaid
  const paymentIds: string[] = []
  const appliedInvoices: AppliedInvoicePayment[] = []

  // The real fee this transaction cost, attributed once — to whichever
  // payment row (invoice or credit-balance) gets created first below. A
  // transfer that spans multiple invoices produces several `payments` rows
  // from one real transaction; attributing the fee to every row would double
  // (or triple) it when the fee-buffer dashboard sums this column.
  const totalProviderFee = Math.max(0, amountPaid - settlementAmount)
  let feeAttributed = false
  const nextProviderFee = () => {
    if (feeAttributed) return null
    feeAttributed = true
    return totalProviderFee
  }

  // Payment-confirmation message is best-effort — a student/school lookup
  // miss or a delivery failure should never break payment processing itself.
  // Built once per student touched (not just the caller's studentId) since a
  // family payment can post to several siblings' invoices in one pass, each
  // needing its own child's name in the message.
  interface NotifyInfo {
    phone?: string
    email?: string
    parentName?: string
    studentName: string
    schoolName: string
    schoolFullName: string
    accountNumber: string
  }
  const notifyByStudent = new Map<string, NotifyInfo>()
  if (studentIds.length > 0) {
    const [{ data: studentsData }, { data: school }] = await Promise.all([
      supabase
        .from('students')
        .select('id, first_name, last_name, provider_dva_account_number, families(primary_parent_name, primary_parent_phone, primary_parent_email)')
        .in('id', studentIds),
      supabase.from('schools').select('name, settings').eq('id', schoolId).single(),
    ])

    // A family payment is addressed to the family's own DVA account, not any
    // one child's — that's the number the parent actually sees on their bank
    // statement, so every message from this transaction should reference it.
    let familyAccountNumber: string | null = null
    if (familyId) {
      const { data: familyRow } = await supabase
        .from('families')
        .select('provider_dva_account_number')
        .eq('id', familyId)
        .single()
      familyAccountNumber = familyRow?.provider_dva_account_number || null
    }

    for (const s of studentsData || []) {
      const phone = (s.families as any)?.primary_parent_phone
      const email = (s.families as any)?.primary_parent_email
      const parentName = (s.families as any)?.primary_parent_name
      const accountNumber = familyId ? familyAccountNumber : s.provider_dva_account_number
      if ((phone || email) && accountNumber) {
        notifyByStudent.set(s.id, {
          phone,
          email,
          parentName,
          studentName: `${s.first_name} ${s.last_name}`.trim(),
          schoolName: getSchoolSmsName(school),
          schoolFullName: school?.name || '',
          accountNumber,
        })
      }
    }
  }

  // Tracks who last absorbed money from this transaction, so a remainder
  // beyond every open invoice has somewhere deterministic to land.
  let lastTouchedStudentId: string | null = null

  // A family payment fans across every sibling's invoices in this same loop
  // — accumulated here instead of messaged per-invoice, so one transfer
  // produces one message to the parent (below the loop) instead of one per
  // child/invoice it happened to touch.
  const familyChildResults: FamilyPaymentChildResult[] = []
  const familyPdfAttachments: { filename: string; content: Buffer; contentType: string }[] = []

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
        p_student_id: invoice.student_id,
        p_amount_available: remaining,
        p_method: 'provider_dva',
        p_provider: provider,
        p_provider_reference: providerReference,
        p_provider_transaction_id: providerTransactionId,
        p_paid_at: paidAt,
        p_notes: notes, // cryptographically verified — no manual review needed
        p_provider_fee: nextProviderFee(),
      })
      .single()

    if (error) throw new Error(`Failed to apply payment to invoice ${invoice.id}: ${error.message}`)

    const applyAmount = Number(applyResult.amount_applied)
    if (applyAmount <= 0) continue

    paymentIds.push(applyResult.payment_id)
    remaining -= applyAmount
    lastTouchedStudentId = invoice.student_id

    const newOutstanding = Number(applyResult.new_outstanding)
    const isFull = applyResult.new_status === 'paid' || newOutstanding <= 0
    appliedInvoices.push({
      invoiceId: invoice.id,
      paymentId: applyResult.payment_id,
      amount: applyAmount,
      oldStatus: invoice.status,
      newStatus: isFull ? 'paid' : 'partial',
    })

    const notifyInfo = notifyByStudent.get(invoice.student_id) ?? null
    if (notifyInfo) {
      const termName = (invoice.billing_cycles as any)?.name || ''

      if (familyId) {
        // Defer the actual send — one message goes out after the loop for
        // the whole transaction, not one per invoice it happened to touch.
        familyChildResults.push({
          studentName: notifyInfo.studentName,
          termName,
          amountApplied: applyAmount,
          isFull,
          newOutstanding,
        })
        // A receipt PDF confirms this specific payment against this specific
        // child's invoice regardless of whether it clears the balance
        // (ReceiptPDF.tsx already renders a "balance remaining" line for a
        // partial one) — every sibling touched gets their own attached to
        // the one family email, not just whoever ended up fully paid.
        const invoiceDetail = await getInvoiceByIdForSchool(supabase, schoolId, invoice.id)
        const pdfBuffer = invoiceDetail
          ? await renderReceiptPdfBuffer(invoiceDetail, invoiceDetail.schoolLogoUrl, applyResult.payment_id)
          : null
        if (pdfBuffer) {
          familyPdfAttachments.push({
            filename: `receipt-${notifyInfo.studentName.trim().split(/\s+/)[0].toLowerCase()}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          })
        }
        continue
      }

      const dueDate: string | undefined = (invoice.billing_cycles as any)?.due_date || undefined
      // Prefer the provider's own reference (what a parent would see on their
      // bank statement); fall back to the payment row's id when there isn't
      // one (e.g. a provider that doesn't return a reference).
      const paymentReference = providerReference || applyResult.payment_id
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
            dueDate,
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
          paidAt,
          accountNumber: notifyInfo.accountNumber,
          reference: paymentReference,
        })
        const pdfBuffer = invoiceDetail
          ? await renderReceiptPdfBuffer(invoiceDetail, invoiceDetail.schoolLogoUrl, applyResult.payment_id)
          : null
        emailContent = {
          ...email,
          attachments: pdfBuffer
            ? [{ filename: 'receipt.pdf', content: pdfBuffer, contentType: 'application/pdf' }]
            : undefined,
        }
      }

      await sendMultiChannel(
        { supabase, schoolId, messageType: 'receipt', studentId: invoice.student_id, invoiceId: invoice.id },
        { phone: notifyInfo.phone, email: notifyInfo.email },
        { sms: smsText, email: emailContent }
      )
    }
  }

  // One message for the whole family transaction, covering every sibling's
  // invoice it touched — not one per child (ROADMAP.md, Phase 4, 2026-09-27).
  if (familyId && familyChildResults.length > 0) {
    const anyNotifyInfo = [...notifyByStudent.values()][0]
    if (anyNotifyInfo) {
      const paymentReference = providerReference || paymentIds[paymentIds.length - 1]
      const smsText = composeFamilyPaymentSMS({
        parentName: anyNotifyInfo.parentName,
        schoolName: anyNotifyInfo.schoolName,
        amountPaid: amountPaid - remaining,
        accountNumber: anyNotifyInfo.accountNumber,
        children: familyChildResults,
      })
      const emailContent = anyNotifyInfo.email
        ? {
            ...composeFamilyPaymentEmail({
              parentName: anyNotifyInfo.parentName,
              schoolName: anyNotifyInfo.schoolFullName,
              amountPaid: amountPaid - remaining,
              accountNumber: anyNotifyInfo.accountNumber,
              children: familyChildResults,
              paidAt,
              reference: paymentReference,
            }),
            attachments: familyPdfAttachments.length > 0 ? familyPdfAttachments : undefined,
          }
        : undefined

      await sendMultiChannel(
        { supabase, schoolId, messageType: 'receipt', studentId: lastTouchedStudentId || undefined },
        { phone: anyNotifyInfo.phone, email: anyNotifyInfo.email },
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
    // Whoever last absorbed money from this transaction keeps absorbing the
    // remainder; if nothing was applied at all (no open invoices anywhere in
    // the family), fall back to a deterministic pick so the money still has
    // somewhere to land instead of the call failing outright.
    const creditTargetStudentId = lastTouchedStudentId || [...studentIds].sort()[0]

    const { data: creditPaymentId, error } = await supabase.rpc('insert_credit_balance_payment', {
      p_school_id: schoolId,
      p_student_id: creditTargetStudentId,
      p_amount: remaining,
      p_method: 'provider_dva',
      p_provider: provider,
      p_provider_reference: providerReference,
      p_provider_transaction_id: providerTransactionId,
      p_paid_at: paidAt,
      p_notes: `${notes}; overpayment applied to student credit balance`,
      p_provider_fee: nextProviderFee(),
    })

    if (error) throw new Error(`Failed to record credit-balance payment: ${error.message}`)
    paymentIds.push(creditPaymentId)
    creditBalanceAmount = remaining

    // Informational only — lets the family panel show "excess last applied
    // to X" without re-deriving it from payment history. Never worth failing
    // an already-recorded payment over.
    if (familyId) {
      try {
        await supabase
          .from('families')
          .update({ dva_last_overflow_student_id: creditTargetStudentId })
          .eq('id', familyId)
      } catch {
        // best-effort bookkeeping only
      }
    }

    // The silent-overflow case: the whole transfer landed on the credit
    // balance with no invoice paid this transaction, so neither the per-invoice
    // receipt nor the family consolidated message fired. Without this the parent
    // hears nothing at all after transferring money. Best-effort like every
    // other send here — sendMultiChannel never throws in a way that would undo
    // the already-recorded credit-balance payment above.
    if (appliedInvoices.length === 0 && creditBalanceAmount > 0) {
      const notifyInfo = notifyByStudent.get(creditTargetStudentId) ?? null
      if (notifyInfo) {
        const paymentReference = providerReference || creditPaymentId
        const smsText = composeCreditReceiptSMS({
          schoolName: notifyInfo.schoolName,
          parentName: notifyInfo.parentName,
          studentName: notifyInfo.studentName,
          amountPaid: creditBalanceAmount,
          accountNumber: notifyInfo.accountNumber,
        })
        const emailContent = notifyInfo.email
          ? composeCreditReceiptEmail({
              schoolName: notifyInfo.schoolFullName,
              parentName: notifyInfo.parentName,
              studentName: notifyInfo.studentName,
              amountPaid: creditBalanceAmount,
              accountNumber: notifyInfo.accountNumber,
              paidAt,
              reference: paymentReference,
            })
          : undefined

        await sendMultiChannel(
          { supabase, schoolId, messageType: 'receipt', studentId: creditTargetStudentId },
          { phone: notifyInfo.phone, email: notifyInfo.email },
          { sms: smsText, email: emailContent }
        )
      }
    }
  }

  return { paymentIds, appliedInvoices, creditBalanceAmount }
}
