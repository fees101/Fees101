// Shared by the server action (synchronous Paystack 'processed' response, or
// the bank_transfer path) and the webhook processor (asynchronous
// refund.processed confirmation) — whichever side actually lands a refund in
// 'completed' calls this once, right after, so the audit trail and the parent
// notice are never duplicated or skipped depending on which path completed it.
import { logAuditEvent } from '@/lib/audit/logAudit'
import { sendRefundNotice } from './refundNotify'

export async function finalizeCompletedRefund(supabase: any, refundId: string): Promise<void> {
  const { data: refund } = await supabase
    .from('refunds')
    .select('id, school_id, student_id, amount, refund_method, reason, approved_by, reversal_payment_id')
    .eq('id', refundId)
    .maybeSingle()
  if (!refund || !refund.reversal_payment_id) return

  await logAuditEvent(supabase, {
    schoolId: refund.school_id,
    actorId: refund.approved_by,
    action: 'payment.refund_completed',
    targetType: 'payment',
    targetId: refund.id,
    summary: `Refunded ₦${Math.round(Number(refund.amount)).toLocaleString('en-NG')} via ${
      refund.refund_method === 'paystack_reversal' ? 'Paystack'
        : refund.refund_method === 'chargeback' ? 'a chargeback'
        : 'bank transfer'
    }`,
    metadata: {
      studentId: refund.student_id,
      amount: Number(refund.amount),
      refundMethod: refund.refund_method,
      reversalPaymentId: refund.reversal_payment_id,
    },
  })

  await sendRefundNotice({
    supabase,
    schoolId: refund.school_id,
    studentId: refund.student_id,
    amount: Number(refund.amount),
    refundMethod: refund.refund_method,
    reason: refund.reason,
  })
}
