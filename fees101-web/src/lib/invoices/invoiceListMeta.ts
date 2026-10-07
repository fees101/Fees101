// Shared types/constants for the global Invoices list — kept free of any
// server imports (no Supabase client, no next/headers) so the client list
// component can import them directly without pulling the server-only query
// module (lib/queries/fees.ts, which reaches next/headers via getSchoolContext)
// into the browser bundle. Same principle as lib/activity/activityMeta.ts.

export const INVOICES_PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

export type InvoiceStatusFilter = 'all' | 'settled' | 'partial' | 'overdue' | 'needs_resend' | 'stale_students'

export interface AllInvoiceRow {
  id: string
  invoiceNumber: string | null
  studentId: string
  studentFirstName: string
  studentLastName: string
  studentAdmissionNumber: string
  className: string
  cycleId: string
  cycleName: string
  cycleStatus: 'draft' | 'active' | 'closed'
  totalAmount: number
  paidAmount: number
  outstandingAmount: number
  subtotal: number
  creditApplied: number
  // Both needed so the ledger hero's breakdown can actually reconcile to
  // `total` (total = subtotal - discountAmount + previousBalance - creditApplied,
  // same formula as computeInvoice.ts) instead of silently dropping two of the
  // four components.
  discountAmount: number
  previousBalance: number
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'
  // The student's current roster status — so the list can scope to "open
  // invoice on a student who already left" (stale_students filter) without a
  // second query. Not the invoice's own status.
  studentStatus: string
  sentAt: string | null
  needsResend: boolean
  generatedAt: string
  // Name of the term whose invoice this balance carried forward onto, if any
  // — lets a closed, still-"overdue"-looking old invoice point forward
  // instead of reading as unresolved debt.
  carriedForwardToCycleName: string | null
}

export interface InvoiceCounts {
  all: number
  settled: number
  partial: number
  overdue: number
  needsResend: number
  needsSend: number
  // Open (non-cancelled, outstanding > 0) invoices on a withdrawn/graduated
  // student — money on the books that won't collect itself and needs
  // cancelling or chasing.
  staleStudents: number
}

export interface InvoiceLedgerTotals {
  total: number
  received: number
  outstanding: number
  subtotal: number
  creditApplied: number
  discountAmount: number
  previousBalance: number
}
