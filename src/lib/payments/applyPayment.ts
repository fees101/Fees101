// Applies a verified incoming payment across a student's outstanding
// invoices, oldest term first, spilling any remainder into credit_balance.
// Called only after the webhook processor has already claimed the
// transaction in processed_provider_transactions — this function assumes
// it will run exactly once per real-world transaction.

import { applyCreditBalanceDelta } from '@/lib/computeInvoice'

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

export async function applyMonnifyPayment(params: ApplyPaymentParams): Promise<{ paymentIds: string[] }> {
  const {
    supabase, schoolId, studentId, amountPaid, settlementAmount,
    providerReference, providerTransactionId, paidAt,
  } = params

  // Only invoices in non-closed terms are eligible. A closed term's
  // outstanding balance was already carried forward as a previous_balance
  // line item on a newer invoice (closeTermAndCarryForward) — the debt now
  // lives on that newer invoice's total. Paying the old, frozen invoice
  // directly would settle the same debt twice: once here, and again when
  // the newer invoice (which already includes it) gets paid down.
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, outstanding_amount, billing_cycles!inner(start_date, status)')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
    .gt('outstanding_amount', 0)
    .neq('billing_cycles.status', 'closed')

  const sorted = [...(invoices || [])].sort((a: any, b: any) =>
    a.billing_cycles.start_date.localeCompare(b.billing_cycles.start_date)
  )

  const notes = `provider settlementAmount=${settlementAmount} (fee not deducted from what the student is credited)`
  let remaining = amountPaid
  const paymentIds: string[] = []

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
  }

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

    await applyCreditBalanceDelta(supabase, schoolId, studentId, remaining)
  }

  return { paymentIds }
}
