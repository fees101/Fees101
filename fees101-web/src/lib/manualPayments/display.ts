// Client-safe display helpers and row shapes for the manual payment entry
// feature. This module deliberately imports NOTHING server-only (no
// next/headers, no supabase/server, no permissions) so the client workspace
// can pull the label helpers and types without dragging the server read module
// (and its request-time APIs) into the browser bundle. The server read module
// in queries/manualPayments.ts re-exports these for back-compat.

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  pos: 'POS / card',
  cheque: 'Cheque',
  other: 'Other',
}

const DEPOSIT_LABELS: Record<string, string> = {
  school_bank: "School's bank account",
  paystack_dva: 'Fees101 transfer account',
  other: 'Other',
}

export function manualPaymentMethodLabel(method: string): string {
  return METHOD_LABELS[method] || method
}

export function manualPaymentDepositLabel(depositedTo: string): string {
  return DEPOSIT_LABELS[depositedTo] || depositedTo
}

export interface PendingManualPayment {
  id: string
  studentId: string
  studentName: string
  className: string
  invoiceId: string | null
  cycleName: string | null
  amount: number
  method: string
  depositedTo: string
  depositReference: string | null
  notes: string | null
  requestedByName: string
  requestedAt: string
  // A pending reversal of a previously approved entry. The amount is negative;
  // the UI frames it as a correction, never a payment.
  isReversal: boolean
}

export interface DecidedManualPayment {
  id: string
  studentId: string
  studentName: string
  className: string
  invoiceId: string | null
  cycleName: string | null
  amount: number
  method: string
  depositedTo: string
  depositReference: string | null
  notes: string | null
  status: 'approved' | 'rejected'
  autoApproved: boolean
  requestedByName: string
  requestedAt: string
  reviewedByName: string | null
  reviewedAt: string | null
  reviewNote: string | null
  isReversal: boolean
  // True once a later approved reversal has fully cancelled this entry out, so
  // the history can show it as reversed rather than offer to reverse it again.
  reversed: boolean
  paymentId: string | null
}
