import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'
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

  for (const studentId of studentIds) {
    const computed = await computeInvoiceForStudent(supabase, schoolId, studentId, cycleId)
    if ('error' in computed) {
      errors.push({ label: studentNames[studentId] || studentId, error: computed.error })
      continue
    }

    const status: 'pending' | 'paid' = computed.total === 0 ? 'paid' : 'pending'
    const invoiceNumber = `INV-${yy}/${String(nextSeq).padStart(5, '0')}`

    const { data: inserted, error } = await supabase
      .from('invoices')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        billing_cycle_id: cycleId,
        invoice_number: invoiceNumber,
        line_items: computed.lineItems,
        subtotal: computed.subtotal,
        discount_amount: computed.discountAmount,
        discount_reason: computed.discountReason || null,
        previous_balance: computed.previousBalance,
        previous_balance_from_invoice_id: computed.previousInvoiceId,
        credit_applied: computed.creditApplied,
        total_amount: computed.total,
        paid_amount: 0,
        status,
        sent_at: null,
        needs_resend: false,
        generated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      errors.push({ label: studentNames[studentId] || studentId, error: error.message })
      continue
    }
    if (computed.appliedDiscounts.length > 0) {
      await recordAppliedDiscounts(supabase, schoolId, studentId, inserted.id, computed.appliedDiscounts)
    }
    if (computed.creditApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, studentId, -computed.creditApplied)
    }
    nextSeq++
    generated++
  }

  return { generated, errors, nextSeq }
}

// ---------------------------------------------------------------------------
// Regeneration (recompute existing invoices whose fee structure changed)
// ---------------------------------------------------------------------------

export async function prepareInvoiceRegeneration(supabase: any, schoolId: string, cycleId: string) {
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
    .select('id')
    .eq('billing_cycle_id', cycleId)
    .eq('school_id', schoolId)

  return { cycle, invoiceIds: (invoices || []).map((i: any) => i.id) }
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
    .select('id, student_id, total_amount, paid_amount, sent_at, credit_applied')
    .in('id', invoiceIds)

  let regenerated = 0
  let alreadyUpToDate = 0
  const errors: { label: string; error: string }[] = []

  for (const inv of invoices || []) {
    const previouslyApplied = Number(inv.credit_applied || 0)
    if (previouslyApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, previouslyApplied)
    }

    const paid = Number(inv.paid_amount || 0)
    const computed = await computeInvoiceForStudent(supabase, schoolId, inv.student_id, cycleId, undefined, paid, inv.id)
    if ('error' in computed) {
      if (previouslyApplied > 0) {
        await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, -previouslyApplied)
      }
      errors.push({ label: inv.student_id, error: computed.error })
      continue
    }

    if (computed.total === Number(inv.total_amount)) {
      if (computed.creditApplied > 0) {
        await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, -computed.creditApplied)
      }
      alreadyUpToDate++
      continue
    }

    let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
    if (paid >= computed.total) newStatus = 'paid'
    else if (paid > 0) newStatus = 'partial'

    const { error } = await supabase
      .from('invoices')
      .update({
        line_items: computed.lineItems,
        subtotal: computed.subtotal,
        discount_amount: computed.discountAmount,
        discount_reason: computed.discountReason || null,
        previous_balance: computed.previousBalance,
        previous_balance_from_invoice_id: computed.previousInvoiceId,
        credit_applied: computed.creditApplied,
        total_amount: computed.total,
        status: newStatus,
        needs_resend: !!inv.sent_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inv.id)

    if (error) {
      errors.push({ label: inv.student_id, error: error.message })
      continue
    }
    await recordAppliedDiscounts(supabase, schoolId, inv.student_id, inv.id, computed.appliedDiscounts)
    if (computed.creditApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, -computed.creditApplied)
    }
    regenerated++
  }

  return { regenerated, alreadyUpToDate, errors }
}
