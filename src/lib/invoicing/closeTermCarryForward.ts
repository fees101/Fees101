import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'

// Chunkable carry-forward-invoice recompute, extracted out of
// fees/cycles/actions.ts's closeTermAndCarryForward so the background-job
// worker route (src/app/api/jobs/process/route.ts) and the daily sweep can
// both call the same per-invoice logic — the old loop ran end-to-end
// synchronously inside the close-term request, same timeout risk as the
// already-fixed invoice generation loop.

export interface CarryForwardInvoiceRow {
  id: string
  student_id: string
  billing_cycle_id: string
  paid_amount: number | string | null
  sent_at: string | null
  credit_applied: number | string | null
}

export interface CarryForwardChunkResult {
  updated: number
  needingResend: number
  failures: { label: string; error: string }[]
}

export async function processCloseTermCarryForwardChunk(
  supabase: any,
  schoolId: string,
  invoices: CarryForwardInvoiceRow[]
): Promise<CarryForwardChunkResult> {
  let updated = 0
  let needingResend = 0
  const failures: { label: string; error: string }[] = []

  for (const inv of invoices) {
    // Undo whatever credit this invoice previously consumed before
    // recomputing with the new carry-forward balance folded in.
    const previouslyApplied = Number(inv.credit_applied || 0)
    if (previouslyApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, previouslyApplied)
    }

    const paid = Number(inv.paid_amount || 0)
    // Pass inv.id so a manual one-off discount on this future-term invoice
    // survives the recompute triggered by closing the current term.
    const computed = await computeInvoiceForStudent(supabase, schoolId, inv.student_id, inv.billing_cycle_id, undefined, paid, inv.id)
    if ('error' in computed) {
      // Compute failed (e.g. the student was withdrawn/graduated before this
      // close) — put back the credit we optimistically restored above, or it
      // would be double-counted: sitting on the balance AND still marked
      // credit_applied on this untouched invoice, duplicating every re-close.
      if (previouslyApplied > 0) {
        await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, -previouslyApplied)
      }
      failures.push({ label: inv.id, error: computed.error })
      continue
    }

    let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
    if (paid >= computed.total) newStatus = 'paid'
    else if (paid > 0) newStatus = 'partial'

    const wasSent = !!inv.sent_at

    await supabase
      .from('invoices')
      .update({
        line_items: computed.lineItems,
        subtotal: computed.subtotal,
        previous_balance: computed.previousBalance,
        previous_balance_from_invoice_id: computed.previousInvoiceId,
        credit_applied: computed.creditApplied,
        total_amount: computed.total,
        status: newStatus,
        needs_resend: wasSent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inv.id)

    if (computed.creditApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, -computed.creditApplied)
    }

    updated++
    if (wasSent) needingResend++
  }

  return { updated, needingResend, failures }
}
