'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { computeInvoiceForStudent, ComputedInvoice, applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'
import { carryForwardFeeAdjustments } from '@/lib/fees/carryForwardAdjustments'
import { PromotionDecision } from '@/lib/yearEnd/promotion'
import { logAuditEvent } from '@/lib/audit/logAudit'

async function getContext(perm: string = 'manage-fee-structure') {
  // Fee/session/term/cycle edits require manage-fee-structure by default;
  // invoice generation and year-end rollover use their own dedicated
  // permissions (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission(perm)
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

// ============ SESSIONS ============

export async function createSession(form: {
  name: string
  startDate: string
  endDate: string
  status?: 'draft' | 'active'
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

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

  const status = form.status || 'draft'

  // Only one session can be "current" at a time — closing the prior active
  // one here (not in a separate step) prevents a window where two sessions
  // are simultaneously active.
  if (status === 'active') {
    await supabase
      .from('sessions')
      .update({ status: 'closed' })
      .eq('school_id', schoolId)
      .eq('status', 'active')
  }

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      school_id: schoolId,
      name,
      start_date: form.startDate,
      end_date: form.endDate,
      status,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'session.created',
    targetType: 'session',
    targetId: data.id,
    summary: `Created session ${name}`,
    metadata: { name, startDate: form.startDate, endDate: form.endDate, status },
  })

  revalidatePath('/fees/cycles')
  revalidatePath('/settings/academic-structure')
  return { success: true, sessionId: data.id }
}

// Only one session is "current" at a time — activating one closes the rest.
export async function setActiveSession(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  // A closed session belongs to a finished academic year — reopening it would
  // reverse a deliberate, record-keeping-significant close. Only draft (being
  // prepared) or already-active sessions may be made current.
  const { data: target } = await supabase
    .from('sessions')
    .select('id, status, name')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()
  if (!target) return { error: 'Session not found' }
  if (target.status === 'closed') {
    return { error: 'This session is closed and belongs to a past academic year — it cannot be set as current again. Contact support if you need to recover it.' }
  }

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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'session.activated',
    targetType: 'session',
    targetId: id,
    summary: `Activated session ${target.name}`,
  })

  revalidatePath('/fees/cycles')
  revalidatePath('/settings/academic-structure')
  return { success: true }
}

export async function closeSession(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: session } = await supabase
    .from('sessions')
    .select('id, name')
    .eq('id', id)
    .eq('school_id', schoolId)
    .maybeSingle()

  const { error } = await supabase
    .from('sessions')
    .update({ status: 'closed' })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'session.closed',
    targetType: 'session',
    targetId: id,
    summary: `Closed session ${session?.name || id}`,
  })

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
      unmatchedAdjustments?: { studentId: string; feeItemName: string }[]
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
  skipAdjustmentCarryForward?: boolean
}): Promise<CreateTermResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

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
      status: form.activateImmediately ? 'active' : 'draft',
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
      closeSummary = await closeTermAndCarryForward(supabase, schoolId, currentActive.id, userId)
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

  let unmatchedAdjustments: { studentId: string; feeItemName: string }[] | undefined
  if (form.rollForwardFromCycleId && newCycle && !form.skipAdjustmentCarryForward) {
    const result = await carryForwardFeeAdjustments(supabase, schoolId, form.rollForwardFromCycleId, newCycle.id)
    unmatchedAdjustments = result.unmatched.length > 0 ? result.unmatched : undefined
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'term.created',
    targetType: 'term',
    targetId: newCycle?.id,
    summary: `Created term ${name}`,
    metadata: { name, startDate: form.startDate, endDate: form.endDate, dueDate: form.dueDate, sessionId, activatedImmediately: !!form.activateImmediately },
  })

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
    unmatchedAdjustments,
  }
}

type UpdateTermResult = { error: string } | { success: true }

export async function updateTerm(id: string, form: {
  name: string
  startDate: string
  endDate: string
  dueDate: string
}): Promise<UpdateTermResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

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

  // A term's session is fixed at creation, not editable afterwards — otherwise
  // a draft term anchored to a past (closed) session could be re-parented onto
  // this year's session, corrupting academic-year record-keeping.
  const { error } = await supabase
    .from('billing_cycles')
    .update({
      name,
      start_date: form.startDate,
      end_date: form.endDate,
      due_date: form.dueDate,
    })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'term.updated',
    targetType: 'term',
    targetId: id,
    summary: `Updated term ${name}`,
    metadata: { name, startDate: form.startDate, endDate: form.endDate, dueDate: form.dueDate },
  })

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

export async function closeTermAndCarryForward(
  supabase: any,
  schoolId: string,
  cycleId: string,
  actorId?: string | null
): Promise<CloseCarryForwardSummary> {
  const { data: closedCycle } = await supabase
    .from('billing_cycles')
    .select('start_date, name')
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

        invoicesUpdated++
        if (wasSent) invoicesNeedingResend++
      }
    }
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: actorId || null,
    action: 'term.closed_carried_forward',
    targetType: 'term',
    targetId: cycleId,
    summary: studentsWithOutstanding.length > 0
      ? `Closed term ${closedCycle?.name || cycleId} and carried forward outstanding balances for ${studentsWithOutstanding.length} student(s) (₦${totalOutstanding.toLocaleString()})`
      : `Closed term ${closedCycle?.name || cycleId} with no outstanding balances to carry forward`,
    metadata: { studentsWithOutstanding: studentsWithOutstanding.length, totalOutstanding, invoicesUpdated, invoicesNeedingResend },
  })

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
  const { supabase, schoolId, userId } = ctx

  // Find the term being activated so we can keep its parent session in sync —
  // otherwise a draft term under an old, never-closed session can go active
  // while that session stays draft/stale, desyncing session and term status.
  const { data: target } = await supabase
    .from('billing_cycles')
    .select('id, session_id, name')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!target) return { error: 'Term not found' }

  if (target.session_id) {
    const { data: session } = await supabase
      .from('sessions')
      .select('id, status, start_date, name')
      .eq('id', target.session_id)
      .single()

    if (session) {
      // A term whose session predates the currently active one belongs to a
      // past academic year — activating it would close this year's live term
      // and reopen a stale one, corrupting record-keeping. Only same-year or
      // future (prepared-ahead) sessions may be activated.
      const { data: currentActiveSession } = await supabase
        .from('sessions')
        .select('id, start_date')
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .maybeSingle()

      if (
        currentActiveSession &&
        currentActiveSession.id !== session.id &&
        session.start_date < currentActiveSession.start_date
      ) {
        return { error: `"${session.name}" is a past session — terms from past academic years can't be activated. Contact support if you need to recover it.` }
      }

      if (session.status !== 'active') {
        const sessResult = await setActiveSession(target.session_id)
        if ('error' in sessResult) return { error: sessResult.error }
      }
    }
  }

  // Find currently active term (the one that will be closed)
  const { data: currentActive } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .maybeSingle()

  let closeSummary: CloseCarryForwardSummary | null = null
  if (currentActive) {
    closeSummary = await closeTermAndCarryForward(supabase, schoolId, currentActive.id, userId)
  }

  // Activate the new term
  const { error } = await supabase
    .from('billing_cycles')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'term.activated',
    targetType: 'term',
    targetId: id,
    summary: `Activated term ${target.name}`,
    metadata: { previouslyActiveTerm: currentActive?.name || null },
  })

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
  const { supabase, schoolId, userId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'Term is already closed' }

  const summary = await closeTermAndCarryForward(supabase, schoolId, id, userId)

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'term.closed',
    targetType: 'term',
    targetId: id,
    summary: `Closed term ${cycle.name}`,
    metadata: summary,
  })

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  revalidatePath(`/fees/cycles/${id}`)
  return { success: true, summary }
}

export async function reopenTermAsDraft(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name')
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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'term.reopened_draft',
    targetType: 'term',
    targetId: id,
    summary: `Reopened term ${cycle.name} as draft`,
  })

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}

export async function deleteTermDraft(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'term.draft_deleted',
    targetType: 'term',
    targetId: id,
    summary: `Deleted draft term ${cycle.name}`,
  })

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
  const ctx = await getContext('manage-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

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

    const { data: inserted, error } = await supabase.from('invoices').insert({
      school_id: schoolId,
      student_id: s.id,
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
    }).select('id').single()

    if (error) {
      errors.push({ studentId: s.id, error: error.message })
      continue
    }
    if (computed.appliedDiscounts.length > 0) {
      await recordAppliedDiscounts(supabase, schoolId, s.id, inserted.id, computed.appliedDiscounts)
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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.generated_bulk',
    targetType: 'billing_cycle',
    targetId: cycleId,
    summary: `Generated ${generated} invoice(s) for term ${cycle.name}${errors.length > 0 ? ` (${errors.length} failed)` : ''}`,
    metadata: { count: generated, failures: errors.length, alreadyHad: alreadyInvoicedIds.size, errors },
  })

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
  const ctx = await getContext('manage-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

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

  if (error) return { error: error.message }

  if (computed.appliedDiscounts.length > 0) {
    await recordAppliedDiscounts(supabase, schoolId, studentId, data.id, computed.appliedDiscounts)
  }
  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, studentId, -computed.creditApplied)
  }

  const { data: student } = await supabase
    .from('students')
    .select('first_name, last_name')
    .eq('id', studentId)
    .maybeSingle()

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.generated',
    targetType: 'invoice',
    targetId: data.id,
    summary: `Generated invoice ${invoiceNumber} for ${student ? `${student.first_name} ${student.last_name}` : studentId} (₦${computed.total.toLocaleString()})`,
    metadata: { studentId, cycleId: targetCycleId, total: computed.total },
  })

  revalidatePath(`/students/${studentId}`)
  revalidatePath(`/fees/cycles/${targetCycleId}`)
  return { success: true, invoiceId: data.id }
}

// REGENERATE existing invoice (recompute line items, keep payments)
export async function regenerateInvoice(invoiceId: string): Promise<
  { error: string } | { success: true; newTotal: number; wasOverpaid: boolean }
> {
  const ctx = await getContext('manage-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, student_id, billing_cycle_id, paid_amount, sent_at, credit_applied, invoice_number, billing_cycles(status)')
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
  const computed = await computeInvoiceForStudent(supabase, schoolId, existing.student_id, existing.billing_cycle_id, undefined, paid, invoiceId)
  if ('error' in computed) {
    // Recompute refused — restore the credit we optimistically returned to the
    // balance above, otherwise it's double-counted (applied on this untouched
    // invoice AND back in the student's balance).
    if (previouslyApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, existing.student_id, -previouslyApplied)
    }
    return { error: computed.error }
  }

  // Determine new status
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
      needs_resend: !!existing.sent_at,  // flag if was previously sent
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)

  if (error) return { error: error.message }

  await recordAppliedDiscounts(supabase, schoolId, existing.student_id, invoiceId, computed.appliedDiscounts)
  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, existing.student_id, -computed.creditApplied)
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.regenerated',
    targetType: 'invoice',
    targetId: invoiceId,
    summary: `Regenerated invoice ${existing.invoice_number || invoiceId} (new total ₦${computed.total.toLocaleString()})`,
    metadata: { studentId: existing.student_id, cycleId: existing.billing_cycle_id, newTotal: computed.total, previousPaid: paid },
  })

  revalidatePath(`/students/${existing.student_id}`)
  revalidatePath(`/fees/cycles/${existing.billing_cycle_id}`)
  return { success: true, newTotal: computed.total, wasOverpaid: paid > computed.total }
}

// REGENERATE every out-of-date invoice in a cycle (skips ones already matching current fees)
export async function regenerateStaleInvoicesForCycle(cycleId: string): Promise<
  { error: string } | { success: true; regenerated: number; alreadyUpToDate: number; errors: { studentId: string; error: string }[] }
> {
  const ctx = await getContext('manage-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name')
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
    const computed = await computeInvoiceForStudent(supabase, schoolId, inv.student_id, cycleId, undefined, paid, inv.id)
    if ('error' in computed) {
      // Recompute refused (e.g. the student is no longer active) — put the
      // credit we optimistically restored back where it was, or it would be
      // double-counted: still recorded as applied on this untouched invoice
      // AND sitting in the student's balance.
      if (previouslyApplied > 0) {
        await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, -previouslyApplied)
      }
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
      errors.push({ studentId: inv.student_id, error: error.message })
      continue
    }
    await recordAppliedDiscounts(supabase, schoolId, inv.student_id, inv.id, computed.appliedDiscounts)
    if (computed.creditApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, inv.student_id, -computed.creditApplied)
    }
    regenerated++
  }

  revalidatePath(`/fees/cycles/${cycleId}`)
  revalidatePath('/fees/cycles')
  revalidatePath('/fees')

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.regenerated_bulk',
    targetType: 'billing_cycle',
    targetId: cycleId,
    summary: `Regenerated ${regenerated} stale invoice(s) for term ${cycle.name}${errors.length > 0 ? ` (${errors.length} failed)` : ''}`,
    metadata: { count: regenerated, failures: errors.length, alreadyUpToDate, errors },
  })

  return { success: true, regenerated, alreadyUpToDate, errors }
}

// ============ YEAR-END ROLLOVER ============
// The most destructive operation in the product: closes the active term,
// promotes every active student's class, graduates exit-year students, and
// generates a full term of invoices, in one run. There is no undo — the only
// recovery is a database restore. Correctness here rests on two things:
// (1) every promotion decision is snapshotted into rollover_promotions
//     BEFORE any mutation happens, so a resume (or an accidental re-click)
//     re-applies the *original* decisions rather than re-deriving them off
//     already-changed class_ids (which would double-promote a student);
// (2) the run's `step` is only advanced after its action succeeds, so a
//     thrown error mid-run leaves `step` pointing at the last completed
//     stage and a resume picks up exactly there.

type RolloverStep = 'started' | 'cycle_created' | 'promoted' | 'adjustments_carried' | 'invoices_generated' | 'completed'

export async function getRolloverStatus() {
  const ctx = await getContext('run-year-end')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: run } = await supabase
    .from('rollover_runs')
    .select('id, status, step, error_detail, from_cycle_id, to_cycle_id, created_at')
    .eq('school_id', schoolId)
    .in('status', ['in_progress', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return { success: true, run: run || null }
}

type NewTermInput = {
  name?: string
  startDate?: string
  endDate?: string
  dueDate?: string
  newSessionName?: string
  newSessionStart?: string
  newSessionEnd?: string
  // Adopt an already-prepared draft session/term instead of creating new ones —
  // lets a school prep next year's fees ahead of time, then roll into it.
  adoptSessionId?: string
  adoptCycleId?: string
}

export async function startYearEndRollover(form: {
  decisions: PromotionDecision[]
  newTerm: NewTermInput
  confirmSessionName: string
}) {
  const ctx = await getContext('run-year-end')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  let expectedSessionName = form.newTerm.newSessionName?.trim()
  if (!expectedSessionName && form.newTerm.adoptCycleId) {
    const { data: adoptedCycle } = await supabase
      .from('billing_cycles')
      .select('session_id')
      .eq('id', form.newTerm.adoptCycleId)
      .eq('school_id', schoolId)
      .maybeSingle()
    if (adoptedCycle?.session_id) {
      const { data: adoptedSession } = await supabase.from('sessions').select('name').eq('id', adoptedCycle.session_id).maybeSingle()
      expectedSessionName = adoptedSession?.name?.trim()
    }
  } else if (!expectedSessionName && form.newTerm.adoptSessionId) {
    const { data: adoptedSession } = await supabase
      .from('sessions')
      .select('name')
      .eq('id', form.newTerm.adoptSessionId)
      .eq('school_id', schoolId)
      .maybeSingle()
    expectedSessionName = adoptedSession?.name?.trim()
  }
  if (!expectedSessionName || form.confirmSessionName.trim() !== expectedSessionName) {
    return { error: 'Confirmation text does not match the session name' }
  }

  // Guard 1: never let two rollovers run concurrently for the same school.
  const { data: existingInProgress } = await supabase
    .from('rollover_runs')
    .select('id')
    .eq('school_id', schoolId)
    .in('status', ['in_progress', 'failed'])
    .maybeSingle()
  if (existingInProgress) {
    return { error: 'A rollover is already in progress (or failed mid-run) for this school. Resume it instead of starting a new one.', runId: existingInProgress.id }
  }

  const { data: currentActive } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .maybeSingle()
  if (!currentActive) return { error: 'No active term to roll over from' }

  // Guard 2: never re-run against a term that's already been rolled over —
  // a double-click or confused re-run must not promote SS1 students who
  // were already moved to SS2 back into a fresh SS2->SS3 jump.
  const { data: alreadyRolled } = await supabase
    .from('rollover_runs')
    .select('id, to_cycle_id')
    .eq('school_id', schoolId)
    .eq('from_cycle_id', currentActive.id)
    .eq('status', 'completed')
    .maybeSingle()
  if (alreadyRolled) {
    return { error: `"${currentActive.name}" has already been rolled over. Re-running would double-promote students.` }
  }

  if (!form.decisions || form.decisions.length === 0) {
    return { error: 'No promotion decisions provided' }
  }

  // Validate the new-term/new-session inputs BEFORE creating the run row.
  // Rollover is destructive and multi-step, so anything we can catch here —
  // a duplicate term/session name, a missing field — should surface as a
  // normal inline validation error the admin can immediately correct,
  // instead of leaving behind a failed run that needs discarding or resuming.
  const nt = form.newTerm
  if (!nt.adoptCycleId) {
    const name = nt.name?.trim()
    if (!name || !nt.startDate || !nt.endDate || !nt.dueDate) {
      return { error: 'New term details are required' }
    }
    if (new Date(nt.endDate) <= new Date(nt.startDate)) {
      return { error: 'End date must be after start date' }
    }
    if (new Date(nt.dueDate) < new Date(nt.startDate)) {
      return { error: 'Due date cannot be before start date' }
    }
    const { data: existingTerm } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('school_id', schoolId)
      .eq('name', name)
      .maybeSingle()
    if (existingTerm) return { error: `A term named "${name}" already exists` }

    if (!nt.adoptSessionId) {
      const newSessionName = nt.newSessionName?.trim()
      if (!newSessionName) return { error: 'New session name is required' }
      const { data: existingSession } = await supabase
        .from('sessions')
        .select('id')
        .eq('school_id', schoolId)
        .eq('name', newSessionName)
        .maybeSingle()
      if (existingSession) return { error: `A session named "${newSessionName}" already exists` }
    }
  }

  const { data: run, error: runError } = await supabase
    .from('rollover_runs')
    .insert({
      school_id: schoolId,
      from_cycle_id: currentActive.id,
      status: 'in_progress',
      step: 'started',
    })
    .select('id')
    .single()
  if (runError || !run) return { error: runError?.message || 'Failed to start rollover' }

  // Snapshot every decision before any mutation — this is what makes a
  // resume safe: it replays these exact rows, never re-derives them from
  // (by-then-mutated) student.class_id.
  const promotionRows = form.decisions.map(d => ({
    run_id: run.id,
    student_id: d.studentId,
    to_class_id: d.action === 'graduate' ? null : d.targetClassId || null,
    action: d.action,
  }))
  const { error: promoRowsError } = await supabase.from('rollover_promotions').insert(promotionRows)
  if (promoRowsError) {
    await supabase.from('rollover_runs').update({ status: 'failed', error_detail: promoRowsError.message }).eq('id', run.id)
    return { error: promoRowsError.message }
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'year_end.started',
    targetType: 'session',
    targetId: run.id,
    summary: `Started year-end rollover from term ${currentActive.name}`,
    metadata: { runId: run.id, fromCycleId: currentActive.id, decisionCount: form.decisions.length },
  })

  return continueYearEndRollover(run.id, form.newTerm)
}

export async function resumeYearEndRollover(runId: string, newTerm?: NewTermInput) {
  const ctx = await getContext('run-year-end')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: run } = await supabase
    .from('rollover_runs')
    .select('id, from_cycle_id, billing_cycles!from_cycle_id(name)')
    .eq('id', runId)
    .eq('school_id', schoolId)
    .maybeSingle()

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'year_end.resumed',
    targetType: 'session',
    targetId: runId,
    // @ts-expect-error — joined
    summary: `Resumed year-end rollover${run?.billing_cycles?.name ? ` from term ${run.billing_cycles.name}` : ''}`,
    metadata: { runId },
  })

  return continueYearEndRollover(runId, newTerm)
}

// A run that failed before creating anything (still at 'started', no
// to_cycle_id) can be safely discarded — e.g. it failed on a term-name
// collision before touching the database — so the admin can fix the details
// and start fresh instead of being forced through "resume" with bad input.
// Once a run has actually created the new term, discarding would orphan it,
// so only 'started'-with-no-to_cycle_id runs are eligible.
export async function cancelYearEndRollover(runId: string): Promise<{ error: string } | { success: true }> {
  const ctx = await getContext('run-year-end')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: run } = await supabase
    .from('rollover_runs')
    .select('id, status, step, to_cycle_id, from_cycle_id')
    .eq('id', runId)
    .eq('school_id', schoolId)
    .single()
  if (!run) return { error: 'Rollover run not found' }
  if (run.status === 'completed') return { error: 'This rollover already completed and cannot be discarded' }
  if (run.step !== 'started' || run.to_cycle_id) {
    return { error: 'This rollover already created the new term — resume it instead of discarding, to avoid an orphaned term.' }
  }

  // Defensive backstop for the rare case where creation started but died
  // before to_cycle_id was persisted: if the term this run was rolling FROM
  // is no longer the active one, createTerm already closed it (and may have
  // created a new session/term). Discarding then would orphan that work and
  // let a re-roll advance the wrong term — force a resume instead.
  const { data: fromCycle } = await supabase
    .from('billing_cycles')
    .select('status')
    .eq('id', run.from_cycle_id)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (fromCycle && fromCycle.status !== 'active') {
    return { error: 'This rollover already began closing the current term — resume it instead of discarding, to avoid leaving the school without an active term.' }
  }

  const { error } = await supabase.from('rollover_runs').delete().eq('id', runId)
  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'year_end.cancelled',
    targetType: 'session',
    targetId: runId,
    summary: `Cancelled year-end rollover run ${runId}`,
  })

  revalidatePath('/fees/year-end')
  return { success: true }
}

async function continueYearEndRollover(runId: string, newTerm?: NewTermInput) {
  const ctx = await getContext('run-year-end')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: run } = await supabase
    .from('rollover_runs')
    .select('*')
    .eq('id', runId)
    .eq('school_id', schoolId)
    .single()
  if (!run) return { error: 'Rollover run not found' }
  if (run.status === 'completed') return { success: true, alreadyCompleted: true }

  let step: RolloverStep = run.step
  let toCycleId: string | null = run.to_cycle_id
  let toSessionId: string | null = run.to_session_id
  let unmatchedAdjustments: { studentId: string; feeItemName: string }[] = []
  let exitInvoiceWarnings: { studentId: string; invoiceId: string }[] = []
  let regeneratedCount = 0
  let regenerateErrors: { studentId: string; error: string }[] = []
  let staleDraftsClosed = 0
  const staleDraftWarnings: { sessionId: string; sessionName: string }[] = []

  try {
    if (step === 'started') {
      // A prior partial attempt may have already created & activated the new
      // term but died before advancing the step (see the immediate persist
      // below). If so, toCycleId is already set — skip creation entirely so a
      // resume doesn't hit a duplicate-name error re-running createTerm.
      if (!toCycleId) {
        if (!newTerm) return { error: 'New term details are required to start the rollover' }

        if (newTerm.adoptCycleId) {
          // Adopt an already-prepared draft term (and its session) wholesale —
          // just close the old term and flip the draft one live.
          const { data: draftCycle } = await supabase
            .from('billing_cycles')
            .select('id, session_id')
            .eq('id', newTerm.adoptCycleId)
            .eq('school_id', schoolId)
            .single()
          if (!draftCycle) throw new Error('Draft term not found')

          await closeTermAndCarryForward(supabase, schoolId, run.from_cycle_id)

          if (draftCycle.session_id) {
            const sessResult = await setActiveSession(draftCycle.session_id)
            if ('error' in sessResult) throw new Error(sessResult.error)
          } else {
            // Session-less draft term: setActiveSession never runs, so close
            // the outgoing session explicitly — otherwise last year's session
            // stays 'active' even though its term was just closed.
            await supabase.from('sessions').update({ status: 'closed' }).eq('school_id', schoolId).eq('status', 'active')
          }

          const { error: activateErr } = await supabase
            .from('billing_cycles')
            .update({ status: 'active' })
            .eq('id', draftCycle.id)
            .eq('school_id', schoolId)
          if (activateErr) throw new Error(activateErr.message)

          toCycleId = draftCycle.id
          toSessionId = draftCycle.session_id || null
        } else if (newTerm.adoptSessionId) {
          // Adopt an already-prepared draft session, but create the new term
          // inside it now (mirrors the fully-new-session path below).
          if (!newTerm.name || !newTerm.startDate || !newTerm.endDate || !newTerm.dueDate) {
            throw new Error('Term details are required')
          }
          const sessResult = await setActiveSession(newTerm.adoptSessionId)
          if ('error' in sessResult) throw new Error(sessResult.error)

          const created = await createTerm({
            name: newTerm.name,
            startDate: newTerm.startDate,
            endDate: newTerm.endDate,
            dueDate: newTerm.dueDate,
            sessionId: newTerm.adoptSessionId,
            rollForwardFromCycleId: run.from_cycle_id,
            activateImmediately: true,
            skipAdjustmentCarryForward: true,
          })
          if ('error' in created) throw new Error(created.error)
          toCycleId = created.cycleId || null
          if (!toCycleId) throw new Error('New term was not created')
          toSessionId = newTerm.adoptSessionId
        } else {
          if (!newTerm.name || !newTerm.startDate || !newTerm.endDate || !newTerm.dueDate || !newTerm.newSessionName) {
            throw new Error('New session and term details are required')
          }
          const created = await createTerm({
            name: newTerm.name,
            startDate: newTerm.startDate,
            endDate: newTerm.endDate,
            dueDate: newTerm.dueDate,
            newSessionName: newTerm.newSessionName,
            newSessionStart: newTerm.newSessionStart,
            newSessionEnd: newTerm.newSessionEnd,
            rollForwardFromCycleId: run.from_cycle_id,
            activateImmediately: true,
            skipAdjustmentCarryForward: true,
          })
          if ('error' in created) throw new Error(created.error)

          toCycleId = created.cycleId || null
          if (!toCycleId) throw new Error('New term was not created')

          const { data: newCycle } = await supabase.from('billing_cycles').select('session_id').eq('id', toCycleId).single()
          toSessionId = newCycle?.session_id || null
        }

        // Persist the new ids IMMEDIATELY — before the stale-draft cleanup
        // below, which can throw. Otherwise a crash there would leave a run
        // that already created & activated the new term yet still reads
        // to_cycle_id=null: un-resumable (createTerm would re-run and hit a
        // duplicate name) and wrongly discard-eligible (cancel would think
        // nothing was created and let a re-roll advance the wrong term).
        await supabase.from('rollover_runs').update({ to_cycle_id: toCycleId, to_session_id: toSessionId }).eq('id', runId)
      }

      // Invariant: a closed session must never still contain an open (draft or
      // active) term. Closing the outgoing session above only closed the term we
      // rolled *from* — a draft term that was prepared inside that same session
      // (or left orphaned in an already-closed session by earlier testing) would
      // otherwise linger as 'draft' and could be activated later by mistake,
      // wrongly re-closing the legitimate current term. Sweep them all shut.
      // Idempotent and self-healing: safe to re-run on resume, and cleans up any
      // pre-existing orphans on the next rollover.
      const { data: closedSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('school_id', schoolId)
        .eq('status', 'closed')
      const closedSessionIds = (closedSessions || []).map(s => s.id)
      if (closedSessionIds.length > 0) {
        await supabase
          .from('billing_cycles')
          .update({ status: 'closed' })
          .eq('school_id', schoolId)
          .in('session_id', closedSessionIds)
          .neq('status', 'closed')
      }

      // Auto-close leftover draft sessions/terms older than the one we just
      // rolled into — otherwise a draft prepared ahead of time (or abandoned
      // from an earlier attempt) sits around indefinitely and can later be
      // activated by mistake, wrongly closing the legitimate current term.
      // Never touches a stale draft that already has invoices on it — those
      // are flagged for manual review instead of being closed silently.
      // Idempotent: safe to re-run on resume (finds fewer/no drafts left).
      if (toSessionId) {
        const { data: newSession } = await supabase.from('sessions').select('start_date').eq('id', toSessionId).single()
        if (newSession) {
          const { data: staleSessions } = await supabase
            .from('sessions')
            .select('id, name')
            .eq('school_id', schoolId)
            .eq('status', 'draft')
            .neq('id', toSessionId)
            .lt('start_date', newSession.start_date)

          for (const stale of staleSessions || []) {
            const { data: staleCycles } = await supabase.from('billing_cycles').select('id').eq('session_id', stale.id)
            const cycleIds = (staleCycles || []).map(c => c.id)
            let hasInvoices = false
            if (cycleIds.length > 0) {
              const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true }).in('billing_cycle_id', cycleIds)
              hasInvoices = (count || 0) > 0
            }
            if (hasInvoices) {
              staleDraftWarnings.push({ sessionId: stale.id, sessionName: stale.name })
            } else {
              if (cycleIds.length > 0) {
                await supabase.from('billing_cycles').update({ status: 'closed' }).in('id', cycleIds)
              }
              await supabase.from('sessions').update({ status: 'closed' }).eq('id', stale.id)
              staleDraftsClosed++
            }
          }
        }
      }

      await supabase.from('rollover_runs').update({ to_cycle_id: toCycleId, to_session_id: toSessionId, step: 'cycle_created' }).eq('id', runId)
      step = 'cycle_created'
    }

    if (step === 'cycle_created') {
      const { data: pendingPromotions } = await supabase
        .from('rollover_promotions')
        .select('id, student_id, to_class_id, action')
        .eq('run_id', runId)
        .is('applied_at', null)

      for (const promo of pendingPromotions || []) {
        if (promo.action === 'graduate') {
          await supabase.from('students').update({ status: 'graduated', graduated_at: new Date().toISOString() }).eq('id', promo.student_id).eq('school_id', schoolId)
        } else if (promo.to_class_id) {
          await supabase.from('students').update({ class_id: promo.to_class_id }).eq('id', promo.student_id).eq('school_id', schoolId)
        }
        await supabase.from('rollover_promotions').update({ applied_at: new Date().toISOString() }).eq('id', promo.id)
      }

      // Exit-student cleanup: a graduating student may already have a preview
      // invoice on the new cycle (drafted ahead of rollover) — but they're no
      // longer 'active', so regenerate/compute will just error on them below.
      // Cancel it outright if untouched; flag it for manual review if any
      // money has already landed on it.
      if (toCycleId) {
        const { data: graduated } = await supabase
          .from('rollover_promotions')
          .select('student_id')
          .eq('run_id', runId)
          .eq('action', 'graduate')

        const graduatedIds = (graduated || []).map(g => g.student_id)
        if (graduatedIds.length > 0) {
          const { data: exitInvoices } = await supabase
            .from('invoices')
            .select('id, student_id, paid_amount, credit_applied')
            .eq('billing_cycle_id', toCycleId)
            .eq('school_id', schoolId)
            .in('student_id', graduatedIds)

          for (const inv of exitInvoices || []) {
            const untouched = Number(inv.paid_amount || 0) <= 0 && Number(inv.credit_applied || 0) <= 0
            if (untouched) {
              await supabase.from('invoices').update({ status: 'cancelled' }).eq('id', inv.id)
            } else {
              exitInvoiceWarnings.push({ studentId: inv.student_id, invoiceId: inv.id })
            }
          }
        }
      }

      await supabase.from('rollover_runs').update({ step: 'promoted' }).eq('id', runId)
      step = 'promoted'
    }

    if (step === 'promoted') {
      if (!toCycleId) throw new Error('Missing new cycle id')
      const result = await carryForwardFeeAdjustments(supabase, schoolId, run.from_cycle_id, toCycleId)
      unmatchedAdjustments = result.unmatched
      await supabase.from('rollover_runs').update({ step: 'adjustments_carried' }).eq('id', runId)
      step = 'adjustments_carried'
    }

    if (step === 'adjustments_carried') {
      if (!toCycleId) throw new Error('Missing new cycle id')

      // Deliberately NOT calling generateInvoicesForCycle here — fees for the
      // new term may not be finalized yet, and sending parents invoices nobody
      // reviewed is worse than making the bursar trigger it manually once ready.
      // We DO still self-heal any invoice that was already previewed ahead of
      // rollover (e.g. under an adopted draft term) so it reflects students'
      // post-promotion classes rather than going stale.
      const regenResult = await regenerateStaleInvoicesForCycle(toCycleId)
      if ('success' in regenResult) {
        regeneratedCount = regenResult.regenerated
        regenerateErrors = regenResult.errors
      }

      await supabase.from('rollover_runs').update({ step: 'invoices_generated' }).eq('id', runId)
      step = 'invoices_generated'
    }

    await supabase
      .from('rollover_runs')
      .update({ step: 'completed', status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', runId)

    revalidatePath('/fees/cycles')
    revalidatePath('/fees')
    revalidatePath('/students')

    return { success: true, toCycleId, toSessionId, unmatchedAdjustments, exitInvoiceWarnings, regeneratedCount, regenerateErrors, staleDraftsClosed, staleDraftWarnings }
  } catch (err: any) {
    await supabase.from('rollover_runs').update({ status: 'failed', error_detail: err.message }).eq('id', runId)
    return { error: err.message, runId, failedAtStep: step }
  }
}