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
    // This loop mutates money (student credit balances), and the job is
    // resumable: the cursor only advances after the whole chunk via
    // updateJobProgress, so a mid-chunk kill (function timeout, crash) leaves
    // the job 'running' with the cursor un-advanced, and the sweep re-runs the
    // same slice. If we trusted the cursor's snapshot of credit_applied here,
    // an already-processed invoice would be undone from its ORIGINAL value
    // again and re-spent — double-counting credit on every resume.
    //
    // So re-read this invoice's CURRENT credit_applied / paid_amount / sent_at
    // fresh from the DB. Then re-processing is idempotent: we always restore
    // exactly what's applied to the invoice right now, recompute, and re-apply,
    // landing on the same balance and the same credit_applied no matter how
    // many times a slice is replayed. (student_id / billing_cycle_id are
    // immutable, so the cursor's copies are fine.)
    const { data: fresh } = await supabase
      .from('invoices')
      .select('id, student_id, billing_cycle_id, paid_amount, sent_at, credit_applied')
      .eq('id', inv.id)
      .eq('school_id', schoolId)
      .maybeSingle()

    // Invoice vanished since the job was queued (student withdrawn/deleted,
    // term removed) — nothing to carry forward, skip without failing.
    if (!fresh) continue

    // Undo whatever credit this invoice CURRENTLY consumes before recomputing
    // with the new carry-forward balance folded in.
    const previouslyApplied = Number(fresh.credit_applied || 0)
    if (previouslyApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, fresh.student_id, previouslyApplied)
    }

    const paid = Number(fresh.paid_amount || 0)
    // Pass the invoice id so a manual one-off discount on this future-term
    // invoice survives the recompute triggered by closing the current term.
    const computed = await computeInvoiceForStudent(supabase, schoolId, fresh.student_id, fresh.billing_cycle_id, undefined, paid, fresh.id)
    if ('error' in computed) {
      // Compute failed (e.g. the student was withdrawn/graduated before this
      // close) — put back the credit we optimistically restored above, or it
      // would be double-counted: sitting on the balance AND still marked
      // credit_applied on this untouched invoice, duplicating every re-close.
      if (previouslyApplied > 0) {
        await applyCreditBalanceDelta(supabase, schoolId, fresh.student_id, -previouslyApplied)
      }
      failures.push({ label: fresh.id, error: computed.error })
      continue
    }

    let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
    if (paid >= computed.total) newStatus = 'paid'
    else if (paid > 0) newStatus = 'partial'

    const wasSent = !!fresh.sent_at

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
      .eq('id', fresh.id)

    if (computed.creditApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, fresh.student_id, -computed.creditApplied)
    }

    updated++
    if (wasSent) needingResend++
  }

  return { updated, needingResend, failures }
}
