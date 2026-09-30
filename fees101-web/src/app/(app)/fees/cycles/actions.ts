'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'
import { carryForwardFeeAdjustments } from '@/lib/fees/carryForwardAdjustments'
import { PromotionDecision } from '@/lib/yearEnd/promotion'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { prepareInvoiceGeneration, prepareInvoiceRegeneration, regenerateStaleInvoicesForCycleSync } from '@/lib/invoicing/invoiceGeneration'
import { createJob, findRunningJob, getJob, updateJobProgress } from '@/lib/jobs/backgroundJobs'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

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
  revalidatePath('/school/academic-structure')
  return { success: true, sessionId: data.id }
}

// Only one session is "current" at a time — activating one closes the rest.
export async function setActiveSession(id: string, reason?: string) {
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
    metadata: reason?.trim() ? { reason: reason.trim() } : undefined,
  })

  revalidatePath('/fees/cycles')
  revalidatePath('/school/academic-structure')
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
  revalidatePath('/school/academic-structure')
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
        jobId: string | null
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
    // Which academic year is the fee's *source* term in, and is the new term a
    // fresh year? This is the whole basis of the once-a-session rule below.
    const { data: sourceCycle } = await supabase
      .from('billing_cycles')
      .select('session_id')
      .eq('id', form.rollForwardFromCycleId)
      .eq('school_id', schoolId)
      .maybeSingle()
    const sourceSessionId: string | null = sourceCycle?.session_id ?? null
    const crossingSession = sourceSessionId !== (sessionId ?? null)

    const feeSelect = 'class_id, name, amount, is_mandatory, is_optional_extra, is_discountable, is_recurring, billing_frequency, display_order'

    // per_term fees always roll forward from the term immediately before this
    // one — they bill on every invoice, so they live on every term. A
    // this_term_only fee never carries (it was charged for one specific term).
    const { data: perTermFees } = await supabase
      .from('fee_items')
      .select(feeSelect)
      .eq('billing_cycle_id', form.rollForwardFromCycleId)
      .eq('school_id', schoolId)
      .eq('billing_frequency', 'per_term')

    const sourceFees: any[] = [...(perTermFees || [])]

    // once_a_session fees carry ONLY when the new term opens a new academic
    // year (the year-end rollover). They bill on their session's first term and
    // only live there, so by the last term (the one we roll from) they're gone
    // — source them from every term of the session we're leaving instead, and
    // dedupe by name + class + required/optional so a fee defined once comes
    // across once. Within the same session, sibling terms get no copy, which is
    // exactly what "once a session" means.
    if (crossingSession && sourceSessionId) {
      const { data: sessionCycles } = await supabase
        .from('billing_cycles')
        .select('id')
        .eq('school_id', schoolId)
        .eq('session_id', sourceSessionId)
      const sessionCycleIds = (sessionCycles || []).map((c: { id: string }) => c.id)
      if (sessionCycleIds.length > 0) {
        const { data: onceFees } = await supabase
          .from('fee_items')
          .select(feeSelect)
          .eq('school_id', schoolId)
          .eq('billing_frequency', 'once_a_session')
          .in('billing_cycle_id', sessionCycleIds)
        const seen = new Set<string>()
        for (const f of onceFees || []) {
          const key = `${f.name}::${f.class_id ?? 'null'}::${f.is_optional_extra}`
          if (seen.has(key)) continue
          seen.add(key)
          sourceFees.push(f)
        }
      }
    }

    if (sourceFees.length > 0) {
      const newFees = sourceFees.map(f => ({
        school_id: schoolId,
        billing_cycle_id: newCycle.id,
        class_id: f.class_id,
        name: f.name,
        amount: f.amount,
        is_mandatory: f.is_mandatory,
        is_optional_extra: f.is_optional_extra,
        is_discountable: f.is_discountable,
        is_recurring: f.is_recurring,
        billing_frequency: f.billing_frequency || (f.is_recurring === false ? 'this_term_only' : 'per_term'),
        display_order: f.display_order || 0,
      }))
      await supabase.from('fee_items').insert(newFees)
    }
  }

  let unmatchedAdjustments: { studentId: string; feeItemName: string }[] | undefined
  if (form.rollForwardFromCycleId && newCycle && !form.skipAdjustmentCarryForward) {
    // Recompute the crossing flag for the adjustment carry (same rule): a
    // once_a_session opt-in only follows the fee across a year boundary.
    const { data: srcForAdj } = await supabase
      .from('billing_cycles')
      .select('session_id')
      .eq('id', form.rollForwardFromCycleId)
      .eq('school_id', schoolId)
      .maybeSingle()
    const crossingSessionForAdj = (srcForAdj?.session_id ?? null) !== (sessionId ?? null)
    const result = await carryForwardFeeAdjustments(supabase, schoolId, form.rollForwardFromCycleId, newCycle.id, crossingSessionForAdj)
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
      jobId: closeSummary.jobId,
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
  // An active term is live: invoices are out and payments may already be in
  // progress, so its dates and name are locked to stay true to what parents
  // received. Changes are only possible before it goes live — undo the
  // activation first (only allowed while nothing has been sent or paid).
  if (cycle.status === 'active') {
    return { error: 'This term is live, so its dates and name are locked. Undo its activation first (only possible before anything has been sent or paid) if you need to change them.' }
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
  // Set when the future-invoice recompute (the loop that risks a serverless
  // timeout on a school with many outstanding students) was handed off to a
  // background_jobs row instead of running inline. `invoicesUpdated`/
  // `invoicesNeedingResend` above are the *queued* counts in that case (same
  // numbers previewCloseTerm already shows before confirming) — the actual
  // per-invoice work finishes asynchronously and the job's own progress/
  // failures are what's authoritative once it completes.
  jobId: string | null
  // Invoices in the term just closed that changed after being sent/paid and
  // were never re-notified — recorded unconditionally, not gated on any
  // confirm step, so closing with un-notified changes is always on record.
  unnotifiedChangedCount: number
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
  let jobId: string | null = null

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

      if (futureInvoices && futureInvoices.length > 0) {
        invoicesUpdated = futureInvoices.length
        invoicesNeedingResend = futureInvoices.filter((i: any) => !!i.sent_at).length

        const job = await createJob({
          schoolId,
          jobType: 'close_term',
          payload: { cycleId, closedCycleName: closedCycle.name || cycleId, studentsWithOutstanding: studentsWithOutstanding.length, totalOutstanding },
          total: futureInvoices.length,
          createdBy: actorId || null,
          cursor: { invoices: futureInvoices },
        })
        jobId = job.id
      }
    }
  }

  const { count: unnotifiedChangedCount } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('billing_cycle_id', cycleId)
    .eq('school_id', schoolId)
    .eq('needs_resend', true)

  // Fired now with the queued counts, not the job's eventual real counts —
  // matches term.closed/term.activated (the callers' own audit events),
  // which already log this same summary synchronously.
  await logAuditEvent(supabase, {
    schoolId,
    actorId: actorId || null,
    action: 'term.closed_carried_forward',
    targetType: 'term',
    targetId: cycleId,
    summary: studentsWithOutstanding.length > 0
      ? `Closed term ${closedCycle?.name || cycleId} and carried forward outstanding balances for ${studentsWithOutstanding.length} student(s) (₦${totalOutstanding.toLocaleString()})`
      : `Closed term ${closedCycle?.name || cycleId} with no outstanding balances to carry forward`,
    metadata: { studentsWithOutstanding: studentsWithOutstanding.length, totalOutstanding, invoicesUpdated, invoicesNeedingResend, jobId, unnotifiedChangedCount: unnotifiedChangedCount || 0 },
  })

  return {
    studentsWithOutstanding: studentsWithOutstanding.length,
    totalOutstanding,
    invoicesUpdated,
    invoicesNeedingResend,
    jobId,
    unnotifiedChangedCount: unnotifiedChangedCount || 0,
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
    .select('id, session_id, name, status')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!target) return { error: 'Term not found' }
  // Mirrors closeTerm's already-closed guard: activating an already-active
  // term would call closeTermAndCarryForward on itself (currentActive.id ===
  // id below), closing and immediately re-opening the same term — a
  // self-referential race hit by a double-click or two concurrent activate
  // calls (2026-09-16 stress test finding).
  if (target.status === 'active') return { error: 'This term is already active' }

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

      // A term whose session ISN'T the current one (a same-year-ahead or
      // future session, prepared as a draft) is a new academic year, not
      // just the next term of this one — activating it here would silently
      // switch sessions and close out the old term with a plain carry-
      // forward, but never promote a single student to their next class
      // (that only happens inside Year-End Rollover). Route through rollover
      // instead, which closes the old term/session and promotes as one step.
      if (currentActiveSession && currentActiveSession.id !== session.id) {
        return {
          error: `"${session.name}" isn't the current session — activating a term there is a new academic year, not just the next term. Use Year-End Rollover instead: it closes out the current year properly and promotes every student to their next class first.`,
        }
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
      jobId: closeSummary?.jobId || null,
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
      unnotifiedChangedCount: number
      // Ledger extras for the dedicated Close term surface (read-only):
      // every invoice in the term locks against edits when it closes, and
      // any active family credit rides forward to reduce a future invoice.
      invoicesLockedCount: number
      studentsWithCreditCount: number
      creditCarried: number
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

  // Invoices already changed and un-notified inside the term being closed —
  // distinct from the future-term staleness above, which is about invoices
  // this carry-forward write is *about to* make stale. This is the "did we
  // leave someone in the dark before finalizing" check.
  const { count: unnotifiedChangedCount } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('billing_cycle_id', cycleId)
    .eq('school_id', schoolId)
    .eq('needs_resend', true)

  // Active-family credit that rides forward. It sits on the student, not the
  // term, so closing doesn't move it — but the ledger states it so the person
  // closing sees the money already working in families' favour next term.
  const { data: creditStudents } = await supabase
    .from('students')
    .select('credit_balance')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .gt('credit_balance', 0)

  const studentsWithCreditCount = (creditStudents || []).length
  const creditCarried = (creditStudents || []).reduce(
    (s: number, x: any) => s + Number(x.credit_balance || 0),
    0
  )

  return {
    success: true as const,
    hasOutstanding: studentsWithOutstanding.length > 0,
    studentsWithOutstandingCount: studentsWithOutstanding.length,
    totalOutstanding,
    futureInvoicesToUpdateCount,
    futureInvoicesNeedingResendCount,
    hasFutureTerm,
    unnotifiedChangedCount: unnotifiedChangedCount || 0,
    invoicesLockedCount: (invoices || []).length,
    studentsWithCreditCount,
    creditCarried,
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

  // closeTermAndCarryForward already logs 'term.closed_carried_forward' for this
  // same term id — do not add a second logAuditEvent call here, it previously
  // produced two audit rows for one close action (fixed 2026-09-16).
  const summary = await closeTermAndCarryForward(supabase, schoolId, id, userId)

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

  // An undo is only safe while the term is "pristine since activation". One
  // read derives every "already operating" signal: a recorded payment
  // (paid_amount > 0, which also subsumes receipts — a receipt only exists for
  // a payment), a sent invoice (a live obligation a parent already holds), or a
  // balance carried IN from a term closed at activation (previous_balance > 0,
  // which an undo cannot unwind since closed terms are permanent). Cancelled
  // invoices are excluded, matching the counts on the Cycles list.
  const { data: invs } = await supabase
    .from('invoices')
    .select('sent_at, paid_amount, previous_balance')
    .eq('billing_cycle_id', id)
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')

  const anyPaid = (invs || []).some(i => Number(i.paid_amount || 0) > 0)
  const anySent = (invs || []).some(i => i.sent_at != null)
  const anyCarriedIn = (invs || []).some(i => Number(i.previous_balance || 0) > 0)

  // Money first (the loudest signal), then sent, then carried-in.
  if (anyPaid) {
    return { error: 'Payments have already been recorded on this term, so it cannot go back to draft. Its dates and name stay locked to match what parents were billed.' }
  }
  if (anySent) {
    return { error: 'Invoices for this term have already been sent to parents, so it cannot go back to draft. Its dates and name stay locked to match what parents received.' }
  }
  if (anyCarriedIn) {
    return { error: 'This term carried unpaid balances forward from the term it replaced, so it cannot go back to draft, and its dates and name stay locked.' }
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

// GENERATE bulk for a cycle — starts a background job the client polls via
// /api/jobs/process instead of computing every student inline in this request
// (the old version could easily exceed a serverless timeout on a large school).
export async function startInvoiceGenerationJob(cycleId: string) {
  const ctx = await getContext('manage-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const existingJob = await findRunningJob(schoolId, 'invoice_generation', { cycleId })
  if (existingJob) return { success: true, jobId: existingJob.id, total: existingJob.total, processed: existingJob.processed, alreadyHad: (existingJob.payload as any).alreadyHad || 0 }

  const prep = await prepareInvoiceGeneration(supabase, schoolId, cycleId)
  if ('error' in prep) return { error: prep.error }

  const job = await createJob({
    schoolId,
    jobType: 'invoice_generation',
    payload: { cycleId, yy: prep.yy, alreadyHad: prep.alreadyHad, studentNames: prep.studentNames },
    total: prep.studentIds.length,
    createdBy: userId,
  })

  const noClassFailures = prep.noClassStudents.map((s: { id: string; name: string }) => ({ label: s.name, error: 'No class assigned' }))
  await updateJobProgress(job.id, {
    cursor: { studentIds: prep.studentIds, nextSeq: prep.startSeq },
    failed: noClassFailures.length,
    failures: noClassFailures,
  })

  return { success: true, jobId: job.id, total: prep.studentIds.length, alreadyHad: prep.alreadyHad }
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
//
// A full recompute touches every line at once (discounts, previous balance,
// credit) so it's blocked once it would actually claw back money already
// paid — i.e. the recomputed total would drop below paid_amount. That's the
// only real risk: a sent-but-unpaid invoice, or a paid invoice where removing
// an unpaid mistaken opt-in still leaves total >= paid (no refund implied),
// can regenerate safely — the invoice is just flagged needs_resend so the
// admin knows to tell the parent the numbers changed. Fee ADDITIONS (mid-term
// opt-ins) don't go through this path at all — they use the additive-only
// engine (addOptInLine.ts) instead, safe regardless of sent/paid. A true
// clawback (recomputed total < paid_amount) still can't be regenerated here —
// that's the real refund case, deferred to manual reconciliation (Scenario B).
export async function regenerateInvoice(invoiceId: string, confirmed: boolean = false): Promise<
  | { error: string }
  | { success: true; newTotal: number }
> {
  const ctx = await getContext('manage-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, student_id, billing_cycle_id, status, paid_amount, sent_at, credit_applied, total_amount, invoice_number, billing_cycles(status), students!inner(credit_balance)')
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!existing) return { error: 'Invoice not found' }
  // @ts-expect-error — joined
  if (existing.billing_cycles?.status === 'closed') {
    return { error: 'This term is closed. Invoices cannot be regenerated.' }
  }
  // A cancelled invoice is a dead record — regenerating it would silently
  // un-cancel it the moment fees drift, with no admin intent behind that.
  if (existing.status === 'cancelled') {
    return { error: 'This invoice was cancelled and cannot be regenerated.' }
  }

  const paid = Number(existing.paid_amount || 0)
  const previouslyApplied = Number(existing.credit_applied || 0)
  // @ts-expect-error — joined
  const liveCreditBalance = Number(existing.students?.credit_balance || 0)

  // See this invoice's own previously-applied credit as already given back
  // (liveCreditBalance + previouslyApplied) without an actual DB write, then
  // persist the invoice + the single net credit delta atomically below —
  // same pattern as processInvoiceRegenerationChunk, avoiding the
  // undo-write/recompute/reapply-write gap the old version had.
  const computed = await computeInvoiceForStudent(
    supabase,
    schoolId,
    existing.student_id,
    existing.billing_cycle_id,
    liveCreditBalance + previouslyApplied,
    paid,
    invoiceId
  )
  if ('error' in computed) return { error: computed.error }

  // The only real risk in a full regenerate: dropping the total below what's
  // already been paid, i.e. an actual clawback. Anything else (sent-but-
  // unpaid, or a paid invoice where the recompute still covers paid_amount —
  // e.g. undoing a mistaken opt-in) is safe to persist; needs_resend below
  // flags it for the admin to tell the parent.
  if (computed.total < paid) {
    return {
      error: 'This change would drop the invoice below what has already been paid, which needs a manual refund/credit reconciliation rather than a regenerate. Contact support to reconcile.',
    }
  }

  // Determine new status
  let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
  if (paid >= computed.total) newStatus = 'paid'
  else if (paid > 0) newStatus = 'partial'

  const { error } = await supabase.rpc('apply_invoice_recompute', {
    p_invoice_id: invoiceId,
    p_school_id: schoolId,
    p_student_id: existing.student_id,
    p_line_items: computed.lineItems,
    p_subtotal: computed.subtotal,
    p_discount_amount: computed.discountAmount,
    p_discount_reason: computed.discountReason || null,
    p_previous_balance: computed.previousBalance,
    p_previous_balance_from_invoice_id: computed.previousInvoiceId,
    p_credit_applied: computed.creditApplied,
    p_total_amount: computed.total,
    p_status: newStatus,
    p_needs_resend: !!existing.sent_at,
    p_credit_delta: previouslyApplied - computed.creditApplied,
  })

  if (error) return { error: error.message }

  await recordAppliedDiscounts(supabase, schoolId, existing.student_id, invoiceId, computed.appliedDiscounts)

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
  return { success: true, newTotal: computed.total }
}

// REGENERATE every out-of-date invoice in a cycle (skips ones already matching current fees,
// and skips — never overwrites — any invoice already sent or paid against)
export async function startInvoiceRegenerationJob(cycleId: string): Promise<
  | { error: string }
  | { success: true; jobId: string; lockedCount: number }
> {
  const ctx = await getContext('manage-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const existingJob = await findRunningJob(schoolId, 'invoice_regeneration', { cycleId })
  if (existingJob) return { success: true, jobId: existingJob.id, lockedCount: 0 }

  const prep = await prepareInvoiceRegeneration(supabase, schoolId, cycleId)
  if ('error' in prep) return { error: prep.error }

  const job = await createJob({
    schoolId,
    jobType: 'invoice_regeneration',
    payload: { cycleId },
    total: prep.invoiceIds.length,
    createdBy: userId,
  })

  await updateJobProgress(job.id, { cursor: { invoiceIds: prep.invoiceIds } })

  return { success: true, jobId: job.id, lockedCount: prep.lockedCount }
}

// Shared poller for both job types — the panel/layout components read
// processed/total/status off this to render progress and know when to stop.
export async function getInvoiceJobStatus(jobId: string) {
  const ctx = await getContext('manage-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const job = await getJob(jobId)
  if (!job || job.school_id !== ctx.schoolId) return { error: 'Job not found' }
  return {
    success: true,
    status: job.status,
    total: job.total,
    processed: job.processed,
    failed: job.failed,
    failures: job.failures,
    error: job.error,
  }
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
  //
  // to_class_id is only ever meaningful for 'promote' — defense in depth
  // against a stale/incorrect targetClassId arriving for 'repeat' (the
  // wizard itself no longer sends one, see YearEndRolloverWizard's
  // buildDecisionList, but this is the actual write path and shouldn't
  // trust the client alone): a 'repeat' row must always leave to_class_id
  // null so the apply step below's `else if (promo.to_class_id)` guard
  // skips the class_id update entirely and the student simply stays put.
  const promotionRows = form.decisions.map(d => ({
    run_id: run.id,
    student_id: d.studentId,
    to_class_id: d.action === 'promote' ? (d.targetClassId || null) : null,
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
  return continueYearEndRolloverCore(ctx.supabase, ctx.schoolId, runId, newTerm)
}

// Service-role entry point for the rollover sweep
// (src/app/api/admin/rollover-sweep/route.ts) — a cron-triggered request has
// no user session/cookies to derive an AuthContext from, so this resolves
// the run's school_id directly with a service-role client instead of going
// through getContext(), then drives the exact same step machine as the
// authenticated resume path above.
//
// Always called with newTerm undefined. That's a real, deliberate limit: a
// run stalled at step 'started' with to_cycle_id still null needs the new
// term/session details typed into the wizard, which are never persisted
// server-side — continueYearEndRolloverCore's own 'started' branch already
// requires newTerm before touching anything, so this safely no-ops (returns
// the same "New term details are required" error the UI shows, leaves the
// row untouched) rather than resuming. Every later step (cycle_created /
// promoted / adjustments_carried) only reads/writes already-persisted DB
// state via the passed-in client and resumes fully automatically — those are
// also the expensive, per-student-loop steps most likely to actually stall.
export async function continueYearEndRolloverForSweep(runId: string) {
  const supabase = createServiceRoleClient()
  const { data: run } = await supabase.from('rollover_runs').select('school_id').eq('id', runId).single()
  if (!run) return { error: 'Rollover run not found' }
  return continueYearEndRolloverCore(supabase, run.school_id, runId, undefined)
}

async function continueYearEndRolloverCore(supabase: any, schoolId: string, runId: string, newTerm?: NewTermInput) {
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
      const closedSessionIds = (closedSessions || []).map((s: any) => s.id)
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
            const cycleIds = (staleCycles || []).map((c: any) => c.id)
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

        const graduatedIds = (graduated || []).map((g: any) => g.student_id)
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
      const regenResult = await regenerateStaleInvoicesForCycleSync(supabase, schoolId, toCycleId)
      if ('success' in regenResult) {
        regeneratedCount = regenResult.regenerated
        regenerateErrors = regenResult.errors.map(e => ({ studentId: e.label, error: e.error }))
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