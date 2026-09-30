import { computeInvoiceForStudent, buildInvoiceComputePreload } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'

// Chunkable invoice generation/regeneration, extracted out of
// fees/cycles/actions.ts so the background-job worker route
// (src/app/api/jobs/process/route.ts) and the server actions that kick a job
// off can both call the same per-student logic — the old
// generateInvoicesForCycle/regenerateStaleInvoicesForCycle ran this same loop
// synchronously end-to-end in one request; this splits it into a "prepare"
// step (figure out total work + numbering) and a "process a slice" step the
// worker calls repeatedly.

export async function resolveInvoiceNumberYear(
  supabase: any,
  cycle: { start_date: string; session_id: string | null }
): Promise<number> {
  if (cycle.session_id) {
    const { data: session } = await supabase
      .from('sessions')
      .select('start_date')
      .eq('id', cycle.session_id)
      .single()
    if (session) return new Date(session.start_date).getFullYear()
  }
  return new Date(cycle.start_date).getFullYear()
}

export async function getCycleIdsInNumberingScope(
  supabase: any,
  schoolId: string,
  cycle: { id: string; session_id: string | null }
): Promise<string[]> {
  if (!cycle.session_id) return [cycle.id]
  const { data } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .eq('session_id', cycle.session_id)
  return (data || []).map((c: any) => c.id)
}

export async function getNextInvoiceSequence(
  supabase: any,
  schoolId: string,
  cycleIds: string[],
  yy: string
): Promise<number> {
  const { data } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('school_id', schoolId)
    .in('billing_cycle_id', cycleIds)
    .like('invoice_number', `INV-${yy}/%`)

  let max = 0
  ;(data || []).forEach((inv: any) => {
    const match = (inv.invoice_number || '').match(/\/(\d{5})$/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > max) max = n
    }
  })
  return max + 1
}

// ---------------------------------------------------------------------------
// Generation (new invoices for students who don't have one yet)
// ---------------------------------------------------------------------------

export async function prepareInvoiceGeneration(supabase: any, schoolId: string, cycleId: string) {
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name, start_date, session_id')
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' as const }
  if (cycle.status === 'closed') return { error: 'Cannot generate invoices for a closed term' as const }

  const { data: students } = await supabase
    .from('students')
    .select('id, class_id, first_name, last_name')
    .eq('school_id', schoolId)
    .eq('status', 'active')

  const { data: existing } = await supabase
    .from('invoices')
    .select('student_id')
    .eq('billing_cycle_id', cycleId)

  const alreadyInvoicedIds = new Set((existing || []).map((i: any) => i.student_id))
  const notYetInvoiced = (students || []).filter((s: any) => !alreadyInvoicedIds.has(s.id))
  const studentIds = notYetInvoiced.filter((s: any) => !!s.class_id).map((s: any) => s.id)
  const noClassStudents = notYetInvoiced
    .filter((s: any) => !s.class_id)
    .map((s: any) => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }))
  const studentNames: Record<string, string> = {}
  for (const s of students || []) studentNames[s.id] = `${s.first_name} ${s.last_name}`

  const yy = String(await resolveInvoiceNumberYear(supabase, cycle)).slice(-2)
  const numberingCycleIds = await getCycleIdsInNumberingScope(supabase, schoolId, cycle)
  const startSeq = await getNextInvoiceSequence(supabase, schoolId, numberingCycleIds, yy)

  return {
    cycle,
    studentIds,
    alreadyHad: alreadyInvoicedIds.size,
    noClassStudents,
    studentNames,
    yy,
    startSeq,
  }
}

export async function processInvoiceGenerationChunk(
  supabase: any,
  schoolId: string,
  cycleId: string,
  studentIds: string[],
  yy: string,
  startSeq: number,
  studentNames: Record<string, string> = {}
): Promise<{ generated: number; errors: { label: string; error: string }[]; nextSeq: number }> {
  let generated = 0
  let nextSeq = startSeq
  const errors: { label: string; error: string }[] = []

  // Batches this chunk's reads into ~8-9 queries total instead of each of the
  // (up to 25) students below firing its own 5-7 sequential queries — same
  // reasoning as the term-page staleness-check fix (src/lib/queries/fees.ts),
  // just applied to the generation write path so progress updates land every
  // few seconds instead of every 10-20+.
  const preload = await buildInvoiceComputePreload(supabase, schoolId, cycleId, studentIds, [])

  for (const studentId of studentIds) {
    const computed = await computeInvoiceForStudent(supabase, schoolId, studentId, cycleId, undefined, 0, undefined, preload)
    if ('error' in computed) {
      errors.push({ label: studentNames[studentId] || studentId, error: computed.error })
      continue
    }

    const status: 'pending' | 'paid' = computed.total === 0 ? 'paid' : 'pending'
    const invoiceNumber = `INV-${yy}/${String(nextSeq).padStart(5, '0')}`

    // This is a resumable chunked job too: a crash between inserting the
    // invoice and spending the credit it used would leave the invoice
    // recorded as having used credit that was never actually deducted from
    // the student's balance — and since (student_id, billing_cycle_id) is
    // unique, a naive retry's re-insert would just fail as a duplicate and
    // skip re-applying the credit, leaving the gap permanent. One RPC does
    // the insert and the credit spend together so they commit as a unit.
    const { data: invoiceId, error } = await supabase.rpc('insert_generated_invoice', {
      p_school_id: schoolId,
      p_student_id: studentId,
      p_billing_cycle_id: cycleId,
      p_invoice_number: invoiceNumber,
      p_line_items: computed.lineItems,
      p_subtotal: computed.subtotal,
      p_discount_amount: computed.discountAmount,
      p_discount_reason: computed.discountReason || null,
      p_previous_balance: computed.previousBalance,
      p_previous_balance_from_invoice_id: computed.previousInvoiceId,
      p_credit_applied: computed.creditApplied,
      p_total_amount: computed.total,
      p_status: status,
    })

    if (error) {
      errors.push({ label: studentNames[studentId] || studentId, error: error.message })
      continue
    }
    if (computed.appliedDiscounts.length > 0) {
      await recordAppliedDiscounts(supabase, schoolId, studentId, invoiceId, computed.appliedDiscounts)
    }
    nextSeq++
    generated++
  }

  return { generated, errors, nextSeq }
}

// ---------------------------------------------------------------------------
// Regeneration (recompute existing invoices whose fee structure changed)
// ---------------------------------------------------------------------------

export async function prepareInvoiceRegeneration(supabase: any, schoolId: string, cycleId: string): Promise<
  { error: string } | { cycle: { id: string; status: string; name: string }; invoiceIds: string[]; lockedCount: number }
> {
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name')
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()
  if (!cycle) return { error: 'Term not found' as const }
  if (cycle.status === 'closed') return { error: 'This term is closed. Invoices cannot be regenerated.' as const }

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, student_id, sent_at, paid_amount, total_amount, credit_applied')
    .eq('billing_cycle_id', cycleId)
    .eq('school_id', schoolId)
    // A cancelled invoice is a dead record — regenerating it would silently
    // un-cancel it (write a new total/status via apply_invoice_recompute)
    // the moment the fee structure it references drifts, with no admin
    // intent behind that. Never eligible.
    .neq('status', 'cancelled')

  // A full regenerate can't safely touch an invoice where the recomputed
  // total would drop below what's already been paid — that's the one real
  // clawback risk (mirrors regenerateInvoice's single-invoice guard). A
  // sent-but-unpaid invoice, or a paid invoice that's still safe to reduce
  // (e.g. undoing a mistaken opt-in), regenerates like any other and gets
  // flagged needs_resend. "Regenerate all" quietly skips the true clawback
  // cases and reports how many were skipped, rather than asking for
  // confirmation to overwrite them — there's no safe "confirmed: true" path
  // for an actual refund case.
  //
  // Also pre-filters to invoices that are actually stale (same
  // needsRegeneration check the cycle-detail page runs) so the job's total
  // only counts real work — otherwise 1 stale invoice among 5 current ones
  // shows a misleading "1/5" that looks stuck when it's actually done.
  let eligible: any[] = []
  let lockedCount = 0
  if ((invoices || []).length > 0) {
    const preload = await buildInvoiceComputePreload(
      supabase,
      schoolId,
      cycleId,
      (invoices || []).map((i: any) => i.student_id),
      (invoices || []).map((i: any) => i.id)
    )
    const checks = await Promise.all(
      (invoices || []).map(async (inv: any) => {
        const previouslyApplied = Number(inv.credit_applied || 0)
        const liveCreditBalance = Number(preload.studentsById.get(inv.student_id)?.credit_balance || 0)
        const paid = Number(inv.paid_amount || 0)
        const computed = await computeInvoiceForStudent(
          supabase, schoolId, inv.student_id, cycleId,
          liveCreditBalance + previouslyApplied, paid, inv.id, preload
        )
        if ('error' in computed) return { stale: true, blocked: false } // let the chunk processor surface the error
        const stale = computed.total !== Number(inv.total_amount) || computed.creditApplied !== previouslyApplied
        return { stale, blocked: computed.total < paid }
      })
    )
    eligible = (invoices || []).filter((_: any, idx: number) => checks[idx].stale && !checks[idx].blocked)
    lockedCount = checks.filter((c) => c.blocked).length
  }

  return { cycle, invoiceIds: eligible.map((i: any) => i.id), lockedCount }
}

// One-shot (non-chunked) regeneration for call sites with a small, bounded
// invoice count — e.g. year-end rollover self-healing invoices previewed
// ahead of the rollover, which is never school-wide. The chunked job path
// above (prepareInvoiceRegeneration + processInvoiceRegenerationChunk in a
// loop) is for the "regenerate all" button, which can span a whole school.
export async function regenerateStaleInvoicesForCycleSync(supabase: any, schoolId: string, cycleId: string) {
  const prep = await prepareInvoiceRegeneration(supabase, schoolId, cycleId)
  if ('error' in prep) return prep
  const result = await processInvoiceRegenerationChunk(supabase, schoolId, cycleId, prep.invoiceIds)
  return { success: true as const, regenerated: result.regenerated, alreadyUpToDate: result.alreadyUpToDate, errors: result.errors }
}

export async function processInvoiceRegenerationChunk(
  supabase: any,
  schoolId: string,
  cycleId: string,
  invoiceIds: string[]
): Promise<{ regenerated: number; alreadyUpToDate: number; errors: { label: string; error: string }[] }> {
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, student_id, status, total_amount, paid_amount, sent_at, credit_applied')
    .in('id', invoiceIds)
    // Defense in depth: prepareInvoiceRegeneration already excludes cancelled
    // invoices from invoiceIds, but this is the actual write path, so it
    // never trusts that alone — a cancelled invoice must never be resurrected.
    .neq('status', 'cancelled')

  let regenerated = 0
  let alreadyUpToDate = 0
  const errors: { label: string; error: string }[] = []

  // Same batched-read fix as generation above. This function itself re-runs
  // fresh on every retry (the caller passes an invoiceIds slice, not a
  // stale cursor snapshot of field values), so the batch reads above and
  // this preload are never stale across a resumed chunk.
  const preload = await buildInvoiceComputePreload(
    supabase,
    schoolId,
    cycleId,
    (invoices || []).map((inv: any) => inv.student_id),
    invoiceIds
  )

  for (const inv of invoices || []) {
    const previouslyApplied = Number(inv.credit_applied || 0)
    const liveCreditBalance = Number(preload.studentsById.get(inv.student_id)?.credit_balance || 0)
    const paid = Number(inv.paid_amount || 0)

    // Resumable job, same reasoning as closeTermCarryForward.ts: rather than
    // undoing this invoice's own previously-applied credit with a real write
    // before recomputing (which left a crash-vulnerable gap between that
    // write, the invoice update, and the final re-apply), see it as already
    // given back via creditBalanceOverride and persist everything — the
    // invoice row and the single net credit delta — in one atomic call below.
    const computed = await computeInvoiceForStudent(
      supabase,
      schoolId,
      inv.student_id,
      cycleId,
      liveCreditBalance + previouslyApplied,
      paid,
      inv.id,
      preload
    )
    if ('error' in computed) {
      // Nothing was written, so there's nothing to unwind.
      errors.push({ label: inv.student_id, error: computed.error })
      continue
    }

    if (computed.total === Number(inv.total_amount) && computed.creditApplied === previouslyApplied) {
      alreadyUpToDate++
      continue
    }

    // Re-guard against a clawback here too — a payment could have landed
    // between prepareInvoiceRegeneration's check and this chunk running.
    if (computed.total < paid) {
      errors.push({ label: inv.student_id, error: 'Would drop the invoice below what has already been paid — needs manual refund/credit reconciliation.' })
      continue
    }

    let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
    if (paid >= computed.total) newStatus = 'paid'
    else if (paid > 0) newStatus = 'partial'

    const { error } = await supabase.rpc('apply_invoice_recompute', {
      p_invoice_id: inv.id,
      p_school_id: schoolId,
      p_student_id: inv.student_id,
      p_line_items: computed.lineItems,
      p_subtotal: computed.subtotal,
      p_discount_amount: computed.discountAmount,
      p_discount_reason: computed.discountReason || null,
      p_previous_balance: computed.previousBalance,
      p_previous_balance_from_invoice_id: computed.previousInvoiceId,
      p_credit_applied: computed.creditApplied,
      p_total_amount: computed.total,
      p_status: newStatus,
      p_needs_resend: !!inv.sent_at,
      p_credit_delta: previouslyApplied - computed.creditApplied,
    })
    if (error) {
      errors.push({ label: inv.student_id, error: error.message })
      continue
    }
    await recordAppliedDiscounts(supabase, schoolId, inv.student_id, inv.id, computed.appliedDiscounts)
    regenerated++
  }

  return { regenerated, alreadyUpToDate, errors }
}
