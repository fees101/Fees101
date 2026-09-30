// Shared types/constants for the global Invoices list — kept free of any
// server imports (no Supabase client, no next/headers) so the client list
// component can import them directly without pulling the server-only query
// module (lib/queries/fees.ts, which reaches next/headers via getSchoolContext)
// into the browser bundle. Same principle as lib/activity/activityMeta.ts.

export const INVOICES_PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

export type InvoiceStatusFilter = 'all' | 'settled' | 'partial' | 'overdue' | 'needs_resend'

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
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'
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
}

export interface InvoiceLedgerTotals {
  total: number
  received: number
  outstanding: number
  subtotal: number
  creditApplied: number
}
