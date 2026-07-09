'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { computeInvoiceForStudent, ComputedInvoice, applyCreditBalanceDelta } from '@/lib/computeInvoice'

async function getContext() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return null

  return { supabase, schoolId, userId: user.id }
}

// ============ SESSIONS ============

export async function createSession(form: {
  name: string
  startDate: string
  endDate: string
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const name = form.name.trim()
  if (!name) return { error: 'Session name is required' }
  if (!form.startDate || !form.endDate) return { error: 'Start and end dates are required' }
  if (new Date(form.endDate) <= new Date(form.startDate)) {
    return { error: 'End date must be after start date' }
  }

  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', name)
    .maybeSingle()
  if (existing) return { error: `A session named "${name}" already exists` }

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      school_id: schoolId,
      name,
      start_date: form.startDate,
      end_date: form.endDate,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/settings/academic-structure')
  return { success: true, sessionId: data.id }
}

// Only one session is "current" at a time — activating one closes the rest.
export async function setActiveSession(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  await supabase
    .from('sessions')
    .update({ status: 'closed' })
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .neq('id', id)

  const { error } = await supabase
    .from('sessions')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/settings/academic-structure')
  return { success: true }
}

export async function closeSession(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { error } = await supabase
    .from('sessions')
    .update({ status: 'closed' })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/settings/academic-structure')
  return { success: true }
}

// ============ TERMS ============

type CreateTermResult =
  | { error: string }
  | {
      success: true
      cycleId: string | undefined
      summary: {
        closedTermName: string | null
        invoicesUpdated: number
        invoicesNeedingResend: number
        studentsWithCarryForward: number
        totalCarryForward: number
      } | null
    }

export async function createTerm(form: {
  name: string
  startDate: string
  endDate: string
  dueDate: string
  sessionId?: string | null
  newSessionName?: string
  newSessionStart?: string
  newSessionEnd?: string
  rollForwardFromCycleId?: string | null
  activateImmediately?: boolean
}): Promise<CreateTermResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const name = form.name.trim()
  if (!name) return { error: 'Term name is required' }
  if (!form.startDate || !form.endDate) return { error: 'Start and end dates are required' }
  if (!form.dueDate) return { error: 'Due date is required' }
  if (new Date(form.endDate) <= new Date(form.startDate)) {
    return { error: 'End date must be after start date' }
  }
  if (new Date(form.dueDate) < new Date(form.startDate)) {
    return { error: 'Due date cannot be before start date' }
  }

  const { data: existing } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', name)
    .maybeSingle()
  if (existing) return { error: `A term named "${name}" already exists` }

  let sessionId: string | null = form.sessionId || null

  if (!sessionId && form.newSessionName) {
    const sessionResult = await createSession({
      name: form.newSessionName,
      startDate: form.newSessionStart || form.startDate,
      endDate: form.newSessionEnd || form.endDate,
    })
    if (sessionResult.error) return { error: sessionResult.error }
    sessionId = sessionResult.sessionId || null
  }

  let closeSummary: CloseCarryForwardSummary | null = null
  let closedTermName: string | null = null

  if (form.activateImmediately) {
    const { data: currentActive } = await supabase
      .from('billing_cycles')
      .select('id, name')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .maybeSingle()

    // Route through the same close+carry-forward path activateTerm uses —
    // a bare status flip here would silently drop outstanding balances.
    if (currentActive) {
      closeSummary = await closeTermAndCarryForward(supabase, schoolId, currentActive.id)
      closedTermName = currentActive.name
    }
  }

  const { data: newCycle, error } = await supabase
    .from('billing_cycles')
    .insert({
      school_id: schoolId,
      name,
      start_date: form.startDate,
      end_date: form.endDate,
      due_date: form.dueDate,
      session_id: sessionId,
      status: form.activateImmediately ? 'active' : 'draft',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  if (form.rollForwardFromCycleId && newCycle) {
    const { data: sourceFees } = await supabase
      .from('fee_items')
      .select('class_id, name, amount, is_mandatory, is_optional_extra, display_order')
      .eq('billing_cycle_id', form.rollForwardFromCycleId)
      .eq('school_id', schoolId)

    if (sourceFees && sourceFees.length > 0) {
      const newFees = sourceFees.map(f => ({
        school_id: schoolId,
        billing_cycle_id: newCycle.id,
        class_id: f.class_id,
        name: f.name,
        amount: f.amount,
        is_mandatory: f.is_mandatory,
        is_optional_extra: f.is_optional_extra,
        display_order: f.display_order || 0,
      }))
      await supabase.from('fee_items').insert(newFees)
    }
  }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  revalidatePath('/fees/structure')
  return {
    success: true,
    cycleId: newCycle?.id,
    summary: closeSummary ? {
      closedTermName,
      invoicesUpdated: closeSummary.invoicesUpdated,
      invoicesNeedingResend: closeSummary.invoicesNeedingResend,
      studentsWithCarryForward: closeSummary.studentsWithOutstanding,
      totalCarryForward: closeSummary.totalOutstanding,
    } : null,
  }
}

type UpdateTermResult = { error: string } | { success: true }

export async function updateTerm(id: string, form: {
  name: string
  startDate: string
  endDate: string
  dueDate: string
  sessionId?: string | null
}): Promise<UpdateTermResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') {
    return { error: 'Closed terms cannot be edited. Contact support if you need to recover a closed term.' }
  }

  const name = form.name.trim()
  if (!name) return { error: 'Term name is required' }
  if (!form.dueDate) return { error: 'Due date is required' }
  if (new Date(form.endDate) <= new Date(form.startDate)) {
    return { error: 'End date must be after start date' }
  }
  if (new Date(form.dueDate) < new Date(form.startDate)) {
    return { error: 'Due date cannot be before start date' }
  }

  const { data: existing } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', name)
    .neq('id', id)
    .maybeSingle()
  if (existing) return { error: `A term named "${name}" already exists` }

  const { error } = await supabase
    .from('billing_cycles')
    .update({
      name,
      start_date: form.startDate,
      end_date: form.endDate,
      due_date: form.dueDate,
      session_id: form.sessionId || null,
    })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}

// ============ CLOSE + CARRY-FORWARD ============
// Shared by activateTerm (which implicitly closes the previous active term)
// and closeTerm (direct close from the cycles list). Both need identical
// behavior: mark closed, find who's owing, push that balance into whatever
// non-closed term(s) already have an invoice for them.

interface CloseCarryForwardSummary {
  studentsWithOutstanding: number
  totalOutstanding: number
  invoicesUpdated: number
  invoicesNeedingResend: number
}

async function closeTermAndCarryForward(
  supabase: any,
  schoolId: string,
  cycleId: string
): Promise<CloseCarryForwardSummary> {
  const { data: closedCycle } = await supabase
    .from('billing_cycles')
    .select('start_date')
    .eq('id', cycleId)
    .single()

  await supabase
    .from('billing_cycles')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', cycleId)
    .eq('school_id', schoolId)

  const { data: invoices } = await supabase
    .from('invoices')
    .select('student_id, total_amount, paid_amount')
    .eq('billing_cycle_id', cycleId)
    .eq('school_id', schoolId)

  const studentsWithOutstanding = (invoices || [])
    .map((inv: any) => ({
      studentId: inv.student_id,
      outstanding: Number(inv.total_amount) - Number(inv.paid_amount || 0),
    }))
    .filter((s: any) => s.outstanding > 0)

  const totalOutstanding = studentsWithOutstanding.reduce((s: number, x: any) => s + x.outstanding, 0)

  let invoicesUpdated = 0
  let invoicesNeedingResend = 0

  if (studentsWithOutstanding.length > 0 && closedCycle) {
    const studentIds = studentsWithOutstanding.map((s: any) => s.studentId)

    // "Future" = any other non-closed term that starts after this one
    const { data: futureCycles } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('school_id', schoolId)
      .neq('status', 'closed')
      .neq('id', cycleId)
      .gt('start_date', closedCycle.start_date)

    const futureCycleIds = (futureCycles || []).map((c: any) => c.id)

    if (futureCycleIds.length > 0) {
      const { data: futureInvoices } = await supabase
        .from('invoices')
        .select('id, student_id, billing_cycle_id, paid_amount, sent_at, credit_applied')
        .in('billing_cycle_id', futureCycleIds)
        .in('student_id', studentIds)

      for (const inv of futureInvoices || []) {
        // Undo whatever credit this invoice previously consumed before
        // recomputing with the new carry-forward balance folded in.
        const previouslyApplied = Number(inv.credit_applied || 0)
        if (previouslyApplied > 0) {
          await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, previouslyApplied)
        }

        const paid = Number(inv.paid_amount || 0)
        const computed = await computeInvoiceForStudent(supabase, schoolId, inv.student_id, inv.billing_cycle_id, undefined, paid)
        if ('error' in computed) continue

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

        invoicesUpdated++
        if (wasSent) invoicesNeedingResend++
      }
    }
  }

  return {
    studentsWithOutstanding: studentsWithOutstanding.length,
    totalOutstanding,
    invoicesUpdated,
    invoicesNeedingResend,
  }
}

export async function activateTerm(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  // Find currently active term (the one that will be closed)
  const { data: currentActive } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .maybeSingle()

  let closeSummary: CloseCarryForwardSummary | null = null
  if (currentActive) {
    closeSummary = await closeTermAndCarryForward(supabase, schoolId, currentActive.id)
  }

  // Activate the new term
  const { error } = await supabase
    .from('billing_cycles')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  revalidatePath(`/fees/cycles/${id}`)

  return {
    success: true,
    summary: {
      closedTermName: currentActive?.name || null,
      invoicesUpdated: closeSummary?.invoicesUpdated || 0,
      invoicesNeedingResend: closeSummary?.invoicesNeedingResend || 0,
      studentsWithCarryForward: closeSummary?.studentsWithOutstanding || 0,
      totalCarryForward: closeSummary?.totalOutstanding || 0,
    },
  }
}

type PreviewCloseTermResult =
  | { error: string }
  | {
      success: true
      hasOutstanding: boolean
      studentsWithOutstandingCount: number
      totalOutstanding: number
      futureInvoicesToUpdateCount: number
      futureInvoicesNeedingResendCount: number
      hasFutureTerm: boolean
    }

// Read-only preview shown in the close-term confirmation modal — no writes.
export async function previewCloseTerm(cycleId: string): Promise<PreviewCloseTermResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, start_date')
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'Term is already closed' }

  const { data: invoices } = await supabase
    .from('invoices')
    .select('student_id, total_amount, paid_amount')
    .eq('billing_cycle_id', cycleId)
    .eq('school_id', schoolId)

  const studentsWithOutstanding = (invoices || [])
    .map((inv: any) => ({
      studentId: inv.student_id,
      outstanding: Number(inv.total_amount) - Number(inv.paid_amount || 0),
    }))
    .filter((s: any) => s.outstanding > 0)

  const totalOutstanding = studentsWithOutstanding.reduce((s: number, x: any) => s + x.outstanding, 0)

  let futureInvoicesToUpdateCount = 0
  let futureInvoicesNeedingResendCount = 0
  let hasFutureTerm = false

  if (studentsWithOutstanding.length > 0) {
    const studentIds = studentsWithOutstanding.map((s: any) => s.studentId)

    const { data: futureCycles } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('school_id', schoolId)
      .neq('status', 'closed')
      .neq('id', cycleId)
      .gt('start_date', cycle.start_date)

    const futureCycleIds = (futureCycles || []).map((c: any) => c.id)
    hasFutureTerm = futureCycleIds.length > 0

    if (futureCycleIds.length > 0) {
      const { data: futureInvoices } = await supabase
        .from('invoices')
        .select('id, sent_at')
        .in('billing_cycle_id', futureCycleIds)
        .in('student_id', studentIds)

      futureInvoicesToUpdateCount = (futureInvoices || []).length
      futureInvoicesNeedingResendCount = (futureInvoices || []).filter((i: any) => !!i.sent_at).length
    }
  }

  return {
    success: true as const,
    hasOutstanding: studentsWithOutstanding.length > 0,
    studentsWithOutstandingCount: studentsWithOutstanding.length,
    totalOutstanding,
    futureInvoicesToUpdateCount,
    futureInvoicesNeedingResendCount,
    hasFutureTerm,
  }
}

type CloseTermResult =
  | { error: string }
  | { success: true, summary: CloseCarryForwardSummary }

export async function closeTerm(id: string): Promise<CloseTermResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'Term is already closed' }

  const summary = await closeTermAndCarryForward(supabase, schoolId, id)

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  revalidatePath(`/fees/cycles/${id}`)
  return { success: true, summary }
}

export async function reopenTermAsDraft(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  
  // Only active terms can be moved back to draft. Closed terms are permanent.
  if (cycle.status === 'closed') {
    return { error: 'Closed terms cannot be reopened. Contact support if you need to recover a closed term.' }
  }
  if (cycle.status === 'draft') {
    return { error: 'Term is already a draft' }
  }

  // Check if any invoices have been SENT to parents.
  // If not sent, we can safely move back to draft.
  const { data: sentInvoices } = await supabase
    .from('invoices')
    .select('id')
    .eq('billing_cycle_id', id)
    .not('sent_at', 'is', null)
    .limit(1)

  if (sentInvoices && sentInvoices.length > 0) {
    return { error: 'Cannot move to draft — invoices have already been sent to parents for this term.' }
  }

  const { error } = await supabase
    .from('billing_cycles')
    .update({ status: 'draft', closed_at: null })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}

export async function deleteTermDraft(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status !== 'draft') {
    return { error: 'Only draft terms can be deleted. Close the term first if needed.' }
  }

  // Block ONLY if any invoices have been sent. Draft invoices are fine to delete.
  const { data: sentInvoices } = await supabase
    .from('invoices')
    .select('id, student_id')
    .eq('billing_cycle_id', id)
    .not('sent_at', 'is', null)
    .limit(1)

  if (sentInvoices && sentInvoices.length > 0) {
    return { error: 'Cannot delete — at least one invoice has already been sent to parents for this term.' }
  }

  // Get all invoices for this cycle (draft ones)
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id')
    .eq('billing_cycle_id', id)

  // Delete payments tied to these invoices (defensive — shouldn't exist for drafts but just in case)
  if (invoices && invoices.length > 0) {
    const invoiceIds = invoices.map(i => i.id)
    await supabase
      .from('payments')
      .delete()
      .in('invoice_id', invoiceIds)

    await supabase
      .from('invoices')
      .delete()
      .in('id', invoiceIds)
  }

  // Delete fee items + their opt-ins
  const { data: feeItems } = await supabase
    .from('fee_items')
    .select('id')
    .eq('billing_cycle_id', id)

  if (feeItems && feeItems.length > 0) {
    await supabase
      .from('student_fee_adjustments')
      .delete()
      .in('fee_item_id', feeItems.map(f => f.id))

    await supabase
      .from('fee_items')
      .delete()
      .eq('billing_cycle_id', id)
  }

  // Delete the term
  const { error } = await supabase
    .from('billing_cycles')
    .delete()
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}
// ============ INVOICE GENERATION ============

// PREVIEW: Compute invoices for a cycle without saving
export async function previewInvoicesForCycle(cycleId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  // Check cycle
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name')
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'Cannot generate invoices for a closed term' }

  // Get all active students
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name, class_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')

  // Get students who already have an invoice
  const { data: existingInvoices } = await supabase
    .from('invoices')
    .select('student_id')
    .eq('billing_cycle_id', cycleId)

  const alreadyInvoicedIds = new Set((existingInvoices || []).map(i => i.student_id))

  const toGenerate: ComputedInvoice[] = []
  const skipped: { studentId: string, reason: string }[] = []
  let warningStudentsNoClass = 0
  let totalExpected = 0

  for (const s of students || []) {
    if (alreadyInvoicedIds.has(s.id)) {
      skipped.push({ studentId: s.id, reason: 'already has invoice' })
      continue
    }
    if (!s.class_id) {
      warningStudentsNoClass++
      skipped.push({ studentId: s.id, reason: 'no class assigned' })
      continue
    }

    const result = await computeInvoiceForStudent(supabase, schoolId, s.id, cycleId)
    if ('error' in result) {
      skipped.push({ studentId: s.id, reason: result.error })
      continue
    }
    toGenerate.push(result)
    totalExpected += result.total
  }

  return {
    cycleName: cycle.name,
    toGenerateCount: toGenerate.length,
    alreadyHaveCount: alreadyInvoicedIds.size,
    noClassCount: warningStudentsNoClass,
    skippedTotalCount: skipped.length,
    totalExpected,
    preview: toGenerate,
  }
}

// ============ INVOICE NUMBERING ============
// Format: INV-{YY}/{5-digit sequence}. YY = last 2 digits of the academic
// session's start year (falls back to the term's own start year if it has
// no session). Sequence resets per session — standalone terms with no
// session act as their own scope.

async function resolveInvoiceNumberYear(
  supabase: any,
  cycle: { start_date: string, session_id: string | null }
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

async function getCycleIdsInNumberingScope(
  supabase: any,
  schoolId: string,
  cycle: { id: string, session_id: string | null }
): Promise<string[]> {
  if (!cycle.session_id) return [cycle.id]
  const { data } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .eq('session_id', cycle.session_id)
  return (data || []).map((c: any) => c.id)
}

async function getNextInvoiceSequence(
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

// GENERATE bulk for a cycle
export async function generateInvoicesForCycle(cycleId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name, start_date, session_id')
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'Cannot generate invoices for a closed term' }

  const yy = String(await resolveInvoiceNumberYear(supabase, cycle)).slice(-2)
  const numberingCycleIds = await getCycleIdsInNumberingScope(supabase, schoolId, cycle)
  let nextSeq = await getNextInvoiceSequence(supabase, schoolId, numberingCycleIds, yy)

  // Get all active students with a class
  const { data: students } = await supabase
    .from('students')
    .select('id, class_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .not('class_id', 'is', null)

  // Skip those already with invoices
  const { data: existing } = await supabase
    .from('invoices')
    .select('student_id')
    .eq('billing_cycle_id', cycleId)

  const alreadyInvoicedIds = new Set((existing || []).map(i => i.student_id))
  const toProcess = (students || []).filter(s => !alreadyInvoicedIds.has(s.id))

  let generated = 0
  const errors: { studentId: string, error: string }[] = []

  for (const s of toProcess) {
    const computed = await computeInvoiceForStudent(supabase, schoolId, s.id, cycleId)
    if ('error' in computed) {
      errors.push({ studentId: s.id, error: computed.error })
      continue
    }

    const status: 'pending' | 'paid' = computed.total === 0 ? 'paid' : 'pending'
    const invoiceNumber = `INV-${yy}/${String(nextSeq).padStart(5, '0')}`

    const { error } = await supabase.from('invoices').insert({
      school_id: schoolId,
      student_id: s.id,
      billing_cycle_id: cycleId,
      invoice_number: invoiceNumber,
      line_items: computed.lineItems,
      subtotal: computed.subtotal,
      discount_amount: 0,
      previous_balance: computed.previousBalance,
      credit_applied: computed.creditApplied,
      total_amount: computed.total,
      paid_amount: 0,
      status,
      sent_at: null,
      needs_resend: false,
      generated_at: new Date().toISOString(),
    })

    if (error) {
      errors.push({ studentId: s.id, error: error.message })
      continue
    }
    if (computed.creditApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, s.id, -computed.creditApplied)
    }
    nextSeq++
    generated++
  }

  // Mark cycle as having generated invoices
  await supabase
    .from('billing_cycles')
    .update({ invoices_generated_at: new Date().toISOString() })
    .eq('id', cycleId)

  revalidatePath(`/fees/cycles/${cycleId}`)
  revalidatePath('/fees/cycles')
  revalidatePath('/fees')

  return {
    success: true,
    generated,
    alreadyHad: alreadyInvoicedIds.size,
    errors,
  }
}

// GENERATE single (for late joiner)
export async function generateInvoiceForStudent(studentId: string, cycleId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, start_date, session_id')
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()
  if (!cycle) return { error: 'Term not found' }
  const targetCycleId = cycle.id

  // Check existing
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('student_id', studentId)
    .eq('billing_cycle_id', targetCycleId)
    .maybeSingle()

  if (existing) {
    return { error: 'Invoice already exists for this student. Use regenerate instead to update line items.' }
  }

  const computed = await computeInvoiceForStudent(supabase, schoolId, studentId, targetCycleId!)
  if ('error' in computed) return { error: computed.error }

  const status: 'pending' | 'paid' = computed.total === 0 ? 'paid' : 'pending'

  const yy = String(await resolveInvoiceNumberYear(supabase, cycle)).slice(-2)
  const numberingCycleIds = await getCycleIdsInNumberingScope(supabase, schoolId, cycle)
  const seq = await getNextInvoiceSequence(supabase, schoolId, numberingCycleIds, yy)
  const invoiceNumber = `INV-${yy}/${String(seq).padStart(5, '0')}`

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      billing_cycle_id: targetCycleId,
      invoice_number: invoiceNumber,
      line_items: computed.lineItems,
      subtotal: computed.subtotal,
      discount_amount: 0,
      previous_balance: computed.previousBalance,
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

  if (error) return { error: error.message }

  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, studentId, -computed.creditApplied)
  }

  revalidatePath(`/students/${studentId}`)
  revalidatePath(`/fees/cycles/${targetCycleId}`)
  return { success: true, invoiceId: data.id }
}

// REGENERATE existing invoice (recompute line items, keep payments)
export async function regenerateInvoice(invoiceId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, student_id, billing_cycle_id, paid_amount, sent_at, credit_applied, billing_cycles(status)')
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!existing) return { error: 'Invoice not found' }
  // @ts-expect-error — joined
  if (existing.billing_cycles?.status === 'closed') {
    return { error: 'This term is closed. Invoices cannot be regenerated.' }
  }

  // Undo whatever credit this invoice previously consumed before recomputing,
  // so computeInvoiceForStudent sees the correct available balance.
  const previouslyApplied = Number(existing.credit_applied || 0)
  if (previouslyApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, existing.student_id, previouslyApplied)
  }

  const paid = Number(existing.paid_amount || 0)
  const computed = await computeInvoiceForStudent(supabase, schoolId, existing.student_id, existing.billing_cycle_id, undefined, paid)
  if ('error' in computed) return { error: computed.error }

  // Determine new status
  let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
  if (paid >= computed.total) newStatus = 'paid'
  else if (paid > 0) newStatus = 'partial'

  const { error } = await supabase
    .from('invoices')
    .update({
      line_items: computed.lineItems,
      subtotal: computed.subtotal,
      previous_balance: computed.previousBalance,
      credit_applied: computed.creditApplied,
      total_amount: computed.total,
      status: newStatus,
      needs_resend: !!existing.sent_at,  // flag if was previously sent
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)

  if (error) return { error: error.message }

  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, existing.student_id, -computed.creditApplied)
  }

  revalidatePath(`/students/${existing.student_id}`)
  revalidatePath(`/fees/cycles/${existing.billing_cycle_id}`)
  return { success: true, newTotal: computed.total, wasOverpaid: paid > computed.total }
}

// REGENERATE every out-of-date invoice in a cycle (skips ones already matching current fees)
export async function regenerateStaleInvoicesForCycle(cycleId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()
  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'This term is closed. Invoices cannot be regenerated.' }

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, student_id, total_amount, paid_amount, sent_at, credit_applied')
    .eq('billing_cycle_id', cycleId)
    .eq('school_id', schoolId)

  let regenerated = 0
  let alreadyUpToDate = 0
  const errors: { studentId: string, error: string }[] = []

  for (const inv of invoices || []) {
    // Undo whatever credit this invoice previously consumed before
    // recomputing, so the comparison below and the fresh computation both
    // see the student's true available balance.
    const previouslyApplied = Number(inv.credit_applied || 0)
    if (previouslyApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, previouslyApplied)
    }

    const paid = Number(inv.paid_amount || 0)
    const computed = await computeInvoiceForStudent(supabase, schoolId, inv.student_id, cycleId, undefined, paid)
    if ('error' in computed) {
      errors.push({ studentId: inv.student_id, error: computed.error })
      continue
    }

    if (computed.total === Number(inv.total_amount)) {
      // Nothing actually changed — re-spend the same credit back down.
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
        previous_balance: computed.previousBalance,
        credit_applied: computed.creditApplied,
        total_amount: computed.total,
        status: newStatus,
        needs_resend: !!inv.sent_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inv.id)

    if (error) {
      errors.push({ studentId: inv.student_id, error: error.message })
      continue
    }
    if (computed.creditApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, -computed.creditApplied)
    }
    regenerated++
  }

  revalidatePath(`/fees/cycles/${cycleId}`)
  revalidatePath('/fees/cycles')
  revalidatePath('/fees')

  return { success: true, regenerated, alreadyUpToDate, errors }
}