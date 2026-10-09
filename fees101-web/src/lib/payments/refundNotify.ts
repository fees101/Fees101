// Parent-facing messaging for a completed refund — distinct from
// manualPaymentNotify.ts's "correction" message, because here real money has
// actually moved back to the parent, not just been removed from the ledger.
// Best-effort: a lookup miss or delivery failure must never undo a refund that
// has already been written to the ledger.

import { sendMultiChannel } from '@/lib/messaging/sendMessage'
import { composeRefundSMS, composeRefundEmail } from '@/lib/messaging/composeInvoice'
import { loadNotifyInfo } from './manualPaymentNotify'

export interface RefundNoticeInput {
  supabase: any
  schoolId: string
  studentId: string
  amount: number
  refundMethod: 'paystack_reversal' | 'bank_transfer' | 'chargeback'
  reason?: string
}

export async function sendRefundNotice(input: RefundNoticeInput): Promise<void> {
  try {
    const info = await loadNotifyInfo(input.supabase, input.schoolId, input.studentId)
    if (!info) return

    const smsText = composeRefundSMS({
      schoolName: info.schoolSmsName,
      parentName: info.parentName,
      studentName: info.studentName,
      amountRefunded: input.amount,
      refundMethod: input.refundMethod,
    })
    const emailContent = info.email
      ? composeRefundEmail({
          schoolName: info.schoolFullName,
          parentName: info.parentName,
          studentName: info.studentName,
          amountRefunded: input.amount,
          refundMethod: input.refundMethod,
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
    // best-effort — the refund is already written and must stand
  }
}
