// Parent-facing messaging for manual (cash/POS/cheque) payment entry. Two
// moments send a message, and they are deliberately different:
//
//   approval  -> the normal payment receipt (same templates the webhook flow
//                uses), because to the parent the money has landed on the
//                account exactly as a transfer would have.
//   reversal  -> a distinct "payment correction" message, never a receipt,
//                because money has been taken back off, not received.
//
// Both are best-effort, exactly like applyProviderPayment's receipts: a lookup
// miss or a delivery failure must never undo a ledger entry that has already
// been written.

import { sendMultiChannel } from '@/lib/messaging/sendMessage'
import {
  composeFullPaymentSMS, composeFullPaymentEmail,
  composePartialPaymentSMS,
  composeCreditReceiptSMS, composeCreditReceiptEmail,
  composeManualPaymentCorrectionSMS, composeManualPaymentCorrectionEmail,
} from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'

interface NotifyInfo {
  phone?: string
  email?: string
  parentName?: string
  studentName: string
  schoolSmsName: string
  schoolFullName: string
  accountNumber: string | null
  bankName: string | null
  logoUrl: string | null
}

// Shared lookup: the parent's contact, the student's own collection account,
// and the school's display/SMS name + logo. Returns null when there is no way
// to reach the parent (no phone and no email), so callers can simply skip.
// Exported for reuse by refundNotify.ts — same lookup, different message.
export async function loadNotifyInfo(
  supabase: any,
  schoolId: string,
  studentId: string,
): Promise<NotifyInfo | null> {
  const [{ data: student }, { data: school }] = await Promise.all([
    supabase
      .from('students')
      .select('first_name, last_name, provider_dva_account_number, provider_dva_bank_name, families(primary_parent_name, primary_parent_phone, primary_parent_email)')
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .maybeSingle(),
    supabase
      .from('schools')
      .select('name, settings, logo_url')
      .eq('id', schoolId)
      .maybeSingle(),
  ])

  if (!student) return null
  const phone = (student.families as any)?.primary_parent_phone || undefined
  const email = (student.families as any)?.primary_parent_email || undefined
  if (!phone && !email) return null

  return {
    phone,
    email,
    parentName: (student.families as any)?.primary_parent_name || undefined,
    studentName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
    schoolSmsName: getSchoolSmsName(school),
    schoolFullName: school?.name || '',
    accountNumber: student.provider_dva_account_number || null,
    bankName: student.provider_dva_bank_name || null,
    logoUrl: school?.logo_url || null,
  }
}

export interface ManualPaymentReceiptInput {
  supabase: any
  schoolId: string
  studentId: string
  invoiceId: string | null
  // How much of this entry cleared against an invoice, and whether that invoice
  // is now fully paid. Zero/false for a pure credit-balance top-up.
  invoiceAmount: number
  isFull: boolean
  newOutstanding: number
  // How much of this entry went onto the student's credit balance (overpayment
  // spill, or the whole thing when there was no invoice).
  creditAmount: number
  termName: string | null
  paidAt: string
  reference: string
}

// Sends the parent a receipt for an approved manual payment, mirroring the
// webhook flow: a full-payment receipt (with PDF-less email) when an invoice
// clears, a short partial-payment SMS when it only part-pays, and a credit
// receipt when the money sat on the account instead. Unlike the webhook flow
// this skips the PDF attachment — a manual entry has no provider receipt to
// reproduce, and the SMS/email already state what landed and the balance left.
export async function sendManualPaymentReceipt(input: ManualPaymentReceiptInput): Promise<void> {
  try {
    const info = await loadNotifyInfo(input.supabase, input.schoolId, input.studentId)
    if (!info) return

    // Invoice portion first (if any), then the credit portion. A single entry
    // that both clears an invoice and spills to credit is rare for manual
    // entry, so each part sends its own clear message rather than one merged
    // line the parent has to untangle.
    if (input.invoiceId && input.invoiceAmount > 0) {
      const smsText = input.isFull
        ? composeFullPaymentSMS({
            studentName: info.studentName,
            parentName: info.parentName,
            schoolName: info.schoolSmsName,
            termName: input.termName,
            amountPaid: input.invoiceAmount,
            isManual: true,
          })
        : composePartialPaymentSMS({
            studentName: info.studentName,
            parentName: info.parentName,
            schoolName: info.schoolSmsName,
            amountPaid: input.invoiceAmount,
            balance: input.newOutstanding,
            accountNumber: info.accountNumber || '',
            isManual: true,
          })

      let emailContent
      if (info.email && input.isFull) {
        emailContent = composeFullPaymentEmail({
          studentName: info.studentName,
          parentName: info.parentName,
          schoolName: info.schoolFullName,
          termName: input.termName,
          amountPaid: input.invoiceAmount,
          logoUrl: info.logoUrl,
          paidAt: input.paidAt,
          accountNumber: info.accountNumber || '',
          reference: input.reference,
          isManual: true,
        })
      }

      await sendMultiChannel(
        { supabase: input.supabase, schoolId: input.schoolId, messageType: 'receipt', studentId: input.studentId, invoiceId: input.invoiceId },
        { phone: info.phone, email: info.email },
        { sms: smsText, email: emailContent },
      )
    }

    if (input.creditAmount > 0) {
      const smsText = composeCreditReceiptSMS({
        schoolName: info.schoolSmsName,
        parentName: info.parentName,
        studentName: info.studentName,
        amountPaid: input.creditAmount,
        accountNumber: info.accountNumber || '',
        isManual: true,
      })
      const emailContent = info.email
        ? composeCreditReceiptEmail({
            schoolName: info.schoolFullName,
            parentName: info.parentName,
            studentName: info.studentName,
            amountPaid: input.creditAmount,
            accountNumber: info.accountNumber || '',
            paidAt: input.paidAt,
            reference: input.reference,
            isManual: true,
          })
        : undefined

      await sendMultiChannel(
        { supabase: input.supabase, schoolId: input.schoolId, messageType: 'receipt', studentId: input.studentId },
        { phone: info.phone, email: info.email },
        { sms: smsText, email: emailContent },
      )
    }
  } catch {
    // best-effort — the ledger entry is already written and must stand
  }
}

export interface ManualPaymentCorrectionInput {
  supabase: any
  schoolId: string
  studentId: string
  // The size of the reversal as a positive figure.
  amountReversed: number
  // The student's outstanding balance after the reversal, when the correction
  // was against a specific invoice. Omit for a credit-balance reversal.
  newOutstanding?: number
  reason?: string
}

// Sends the parent the distinct "payment correction" message after a reversal
// is approved. Logged as the 'manual' message type (a correction is neither a
// receipt nor a reminder), keeping the receipt type reserved for money that
// actually arrived.
export async function sendManualPaymentCorrection(input: ManualPaymentCorrectionInput): Promise<void> {
  try {
    const info = await loadNotifyInfo(input.supabase, input.schoolId, input.studentId)
    if (!info) return

    const smsText = composeManualPaymentCorrectionSMS({
      schoolName: info.schoolSmsName,
      parentName: info.parentName,
      studentName: info.studentName,
      amountReversed: input.amountReversed,
      newOutstanding: input.newOutstanding,
      accountNumber: info.accountNumber || undefined,
    })
    const emailContent = info.email
      ? composeManualPaymentCorrectionEmail({
          schoolName: info.schoolFullName,
          parentName: info.parentName,
          studentName: info.studentName,
          amountReversed: input.amountReversed,
          newOutstanding: input.newOutstanding,
          accountNumber: info.accountNumber || undefined,
          bankName: info.bankName || undefined,
          reason: input.reason,
          logoUrl: info.logoUrl,
        })
      : undefined

    await sendMultiChannel(
      { supabase: input.supabase, schoolId: input.schoolId, messageType: 'manual', studentId: input.studentId },
      { phone: info.phone, email: info.email },
      { sms: smsText, email: emailContent },
    )
  } catch {
    // best-effort — the reversal is already written and must stand
  }
}
