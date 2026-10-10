// Client-safe display helpers and row shapes for the refunds feature. No
// server-only imports (no next/headers, no supabase/server) so the client
// workspace can use these without pulling the server read module into the
// browser bundle.

const METHOD_LABELS: Record<string, string> = {
  paystack_reversal: 'Paystack refund',
  monnify_reversal: 'Monnify refund',
  bank_transfer: 'Bank transfer (from school)',
  chargeback: 'Chargeback (card dispute)',
}

const CATEGORY_LABELS: Record<string, string> = {
  overpayment: 'Overpayment',
  withdrawal: 'Student withdrawal',
  duplicate_payment: 'Duplicate payment',
  fee_correction: 'Fee correction',
  parent_request: 'Parent request',
  other: 'Other',
}

export function refundMethodLabel(method: string): string {
  return METHOD_LABELS[method] || method
}

export function refundCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category
}

export interface RefundablePayment {
  id: string
  studentId: string
  studentName: string
  invoiceId: string | null
  cycleName: string | null
  amount: number
  // Amount still refundable after existing completed/processing refunds.
  refundableAmount: number
  provider: string
  providerReference: string | null
  paidAt: string
}

export interface PendingRefund {
  id: string
  studentId: string
  studentName: string
  className: string
  paymentId: string
  invoiceId: string | null
  cycleName: string | null
  // When the ORIGINAL payment was made — context for the approver, since this
  // app deliberately allows refunding a payment from an already-closed term
  // (the same reasoning that lets a late payment still apply to a closed
  // term's invoice). Never used to block anything, just shown.
  paymentPaidAt: string | null
  amount: number
  category: string
  reason: string
  refundMethod: string
  refundReference: string | null
  requestedByName: string
  requestedAt: string
  // True when this row was never requested through Fees101 at all — the
  // webhook DETECTED a refund/chargeback that happened directly on Paystack
  // (requested_by is null; requestedByName reads "Paystack (outside
  // Fees101)"). Changes the Pending list's action from Approve/Reject to
  // Confirm/Dismiss, since there's no request to approve — the money already
  // moved regardless of what Fees101 says.
  initiatedExternally: boolean
}

export interface DecidedRefund {
  id: string
  studentId: string
  studentName: string
  className: string
  paymentId: string
  invoiceId: string | null
  cycleName: string | null
  paymentPaidAt: string | null
  amount: number
  category: string
  reason: string
  refundMethod: string
  refundReference: string | null
  status: 'rejected' | 'processing' | 'completed' | 'failed'
  autoApproved: boolean
  requestedByName: string
  requestedAt: string
  approvedByName: string | null
  approvedAt: string | null
  rejectionReason: string | null
  failureReason: string | null
  processedAt: string | null
  // Paystack's own refund id, once the API call returns — lets staff cross-
  // reference this refund against Paystack's own dashboard.
  paystackRefundId: string | null
  initiatedExternally: boolean
}
