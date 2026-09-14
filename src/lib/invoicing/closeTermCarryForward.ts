import { computeInvoiceForStudent } from '@/lib/computeInvoice'

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
    // same slice. The old version did this as 3 separate network calls (undo
    // old credit, write the invoice row, apply new credit) — a crash between
    // any two of them left the DB half-done in a way a replay couldn't tell
    // apart from "not started," silently mis-crediting the student's balance.
    //
    // So: read fresh (never trust the cursor's snapshot, which goes stale the
    // moment any invoice in the chunk succeeds), compute using a credit
    // override instead of a real DB write to "undo" first, then persist the
    // invoice + the single net credit delta together in one DB transaction
    // (apply_invoice_recompute) so a replay always starts from a consistent
    // state no matter where a prior attempt died.
    const { data: fresh } = await supabase
      .from('invoices')
      .select('id, student_id, billing_cycle_id, paid_amount, sent_at, credit_applied, students!inner(credit_balance)')
      .eq('id', inv.id)
      .eq('school_id', schoolId)
      .maybeSingle()

    // Invoice vanished since the job was queued (student withdrawn/deleted,
    // term removed) — nothing to carry forward, skip without failing.
    if (!fresh) continue

    const previouslyApplied = Number(fresh.credit_applied || 0)
    const liveCreditBalance = Number(fresh.students?.credit_balance || 0)
    const paid = Number(fresh.paid_amount || 0)

    // See this invoice's own previously-applied credit as already given back
    // (liveCreditBalance + previouslyApplied) without an actual DB write —
    // that write happens once, atomically, below, alongside the invoice
    // update. Pass the invoice id so a manual one-off discount on this
    // future-term invoice survives the recompute triggered by closing the
    // current term.
    const computed = await computeInvoiceForStudent(
      supabase,
      schoolId,
      fresh.student_id,
      fresh.billing_cycle_id,
      liveCreditBalance + previouslyApplied,
      paid,
      fresh.id
    )
    if ('error' in computed) {
      // Compute failed (e.g. the student was withdrawn/graduated before this
      // close) — nothing was written, so there's nothing to unwind.
      failures.push({ label: fresh.id, error: computed.error })
      continue
    }

    let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
    if (paid >= computed.total) newStatus = 'paid'
    else if (paid > 0) newStatus = 'partial'

    const wasSent = !!fresh.sent_at

    const { error } = await supabase.rpc('apply_invoice_recompute', {
      p_invoice_id: fresh.id,
      p_school_id: schoolId,
      p_student_id: fresh.student_id,
      p_line_items: computed.lineItems,
      p_subtotal: computed.subtotal,
      p_discount_amount: null,
      p_discount_reason: null,
      p_previous_balance: computed.previousBalance,
      p_previous_balance_from_invoice_id: computed.previousInvoiceId,
      p_credit_applied: computed.creditApplied,
      p_total_amount: computed.total,
      p_status: newStatus,
      p_needs_resend: wasSent,
      p_credit_delta: previouslyApplied - computed.creditApplied,
    })
    if (error) {
      failures.push({ label: fresh.id, error: error.message })
      continue
    }

    updated++
    if (wasSent) needingResend++
  }

  return { updated, needingResend, failures }
}
