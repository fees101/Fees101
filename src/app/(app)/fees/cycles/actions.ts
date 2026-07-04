'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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
  return { success: true, sessionId: data.id }
}

// ============ TERMS ============

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
}) {
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

  if (form.activateImmediately) {
    await supabase
      .from('billing_cycles')
      .update({ status: 'closed' })
      .eq('school_id', schoolId)
      .eq('status', 'active')
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
  return { success: true, cycleId: newCycle?.id }
}

export async function updateTerm(id: string, form: {
  name: string
  startDate: string
  endDate: string
  dueDate: string
  sessionId?: string | null
}) {
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

  // Close current active (if any)
  if (currentActive) {
    await supabase
      .from('billing_cycles')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', currentActive.id)
      .eq('school_id', schoolId)
  }

  // Activate the new term
  const { error } = await supabase
    .from('billing_cycles')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  // Auto-update carry-forward for invoices in the newly-active term
  const summary = {
    closedTermName: currentActive?.name || null,
    invoicesUpdated: 0,
    invoicesNeedingResend: 0,
    studentsWithCarryForward: 0,
    totalCarryForward: 0,
  }

  if (currentActive) {
    // Find students with outstanding balance from the just-closed term
    const { data: outstandingInvoices } = await supabase
      .from('invoices')
      .select('student_id, total_amount, paid_amount')
      .eq('billing_cycle_id', currentActive.id)
      .eq('school_id', schoolId)

    const studentsWithOutstanding = (outstandingInvoices || [])
      .map(inv => ({
        studentId: inv.student_id,
        outstanding: Number(inv.total_amount) - Number(inv.paid_amount || 0),
      }))
      .filter(s => s.outstanding > 0)

    summary.studentsWithCarryForward = studentsWithOutstanding.length
    summary.totalCarryForward = studentsWithOutstanding.reduce((s, x) => s + x.outstanding, 0)

    // For each such student, find their invoice in the NEWLY ACTIVE term (if exists) and regenerate
    for (const s of studentsWithOutstanding) {
      const { data: newTermInvoice } = await supabase
        .from('invoices')
        .select('id, sent_at')
        .eq('student_id', s.studentId)
        .eq('billing_cycle_id', id)
        .maybeSingle()

      if (!newTermInvoice) continue

      // Recompute
      const computed = await computeInvoiceForStudent(supabase, schoolId, s.studentId, id)
      if ('error' in computed) continue

      const { data: existing } = await supabase
        .from('invoices')
        .select('paid_amount')
        .eq('id', newTermInvoice.id)
        .single()

      const paid = Number(existing?.paid_amount || 0)
      let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
      if (paid >= computed.total) newStatus = 'paid'
      else if (paid > 0) newStatus = 'partial'

      const wasSent = !!newTermInvoice.sent_at

      await supabase
        .from('invoices')
        .update({
          line_items: computed.lineItems,
          subtotal: computed.subtotal,
          previous_balance: computed.previousBalance,
          total_amount: computed.total,
          status: newStatus,
          needs_resend: wasSent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', newTermInvoice.id)

      summary.invoicesUpdated++
      if (wasSent) summary.invoicesNeedingResend++
    }
  }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  revalidatePath(`/fees/cycles/${id}`)

  return { success: true, summary }
}

export async function closeTerm(id: string) {
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

  const { error } = await supabase
    .from('billing_cycles')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
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

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}
// ============ INVOICE GENERATION ============

interface ComputedLineItem {
  name: string
  amount: number
  kind: 'required' | 'opt_in' | 'previous_balance'
  fee_item_id?: string
}

interface ComputedInvoice {
  studentId: string
  studentName: string
  className: string
  lineItems: ComputedLineItem[]
  subtotal: number
  previousBalance: number
  total: number
  warning?: string
}

// Compute what a student's invoice would look like for a given cycle
async function computeInvoiceForStudent(
  supabase: any,
  schoolId: string,
  studentId: string,
  cycleId: string
): Promise<ComputedInvoice | { error: string }> {
  // Get student
  const { data: student } = await supabase
    .from('students')
    .select('id, first_name, last_name, class_id, status, classes(name)')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!student) return { error: 'Student not found' }
  if (student.status !== 'active') return { error: `Student is ${student.status}, not active` }

  const studentName = `${student.first_name} ${student.last_name}`
  const className: string = student.classes?.name || ''

  // Fee items: per-class for this student's class + school-wide
  let feeItemsQuery = supabase
    .from('fee_items')
    .select('id, class_id, name, amount, is_mandatory, is_optional_extra')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycleId)

  if (student.class_id) {
    feeItemsQuery = feeItemsQuery.or(`class_id.eq.${student.class_id},class_id.is.null`)
  } else {
    feeItemsQuery = feeItemsQuery.is('class_id', null)
  }

  const { data: feeItems } = await feeItemsQuery
  if (!feeItems || feeItems.length === 0) {
    return {
      studentId,
      studentName,
      className,
      lineItems: [],
      subtotal: 0,
      previousBalance: 0,
      total: 0,
      warning: 'No fees configured for this term',
    }
  }

  // Adjustments
  const { data: adjustments } = await supabase
    .from('student_fee_adjustments')
    .select('fee_item_id, adjustment_type')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)

  const optInIds = new Set((adjustments || []).filter((a: any) => a.adjustment_type === 'opt_in').map((a: any) => a.fee_item_id))
  const exemptIds = new Set((adjustments || []).filter((a: any) => a.adjustment_type === 'exempt').map((a: any) => a.fee_item_id))

  const lineItems: ComputedLineItem[] = []

  feeItems.forEach((f: any) => {
    if (f.is_mandatory) {
      if (!exemptIds.has(f.id)) {
        lineItems.push({
          name: f.name,
          amount: Number(f.amount),
          kind: 'required',
          fee_item_id: f.id,
        })
      }
    } else if (f.is_optional_extra && optInIds.has(f.id)) {
      lineItems.push({
        name: f.name,
        amount: Number(f.amount),
        kind: 'opt_in',
        fee_item_id: f.id,
      })
    }
  })

  // Carry-forward balance from most recent closed term
  let previousBalance = 0
  const { data: thisCycle } = await supabase
    .from('billing_cycles')
    .select('start_date')
    .eq('id', cycleId)
    .single()

  if (thisCycle) {
    const { data: priorClosedCycle } = await supabase
      .from('billing_cycles')
      .select('id, name')
      .eq('school_id', schoolId)
      .eq('status', 'closed')
      .lt('start_date', thisCycle.start_date)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (priorClosedCycle) {
      const { data: priorInvoice } = await supabase
        .from('invoices')
        .select('outstanding_amount, total_amount, paid_amount')
        .eq('student_id', studentId)
        .eq('billing_cycle_id', priorClosedCycle.id)
        .maybeSingle()

      if (priorInvoice) {
        const outstanding = Number(priorInvoice.outstanding_amount ?? (Number(priorInvoice.total_amount) - Number(priorInvoice.paid_amount || 0)))
        if (outstanding > 0) {
          previousBalance = outstanding
          lineItems.push({
            name: `Outstanding balance from ${priorClosedCycle.name}`,
            amount: outstanding,
            kind: 'previous_balance',
          })
        }
      }
    }
  }

  const subtotal = lineItems.filter(li => li.kind !== 'previous_balance').reduce((s, li) => s + li.amount, 0)
  const total = subtotal + previousBalance

  return {
    studentId,
    studentName,
    className,
    lineItems,
    subtotal,
    previousBalance,
    total,
  }
}

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
    .select('id, student_id, billing_cycle_id, paid_amount, sent_at')
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!existing) return { error: 'Invoice not found' }

  const computed = await computeInvoiceForStudent(supabase, schoolId, existing.student_id, existing.billing_cycle_id)
  if ('error' in computed) return { error: computed.error }

  const paid = Number(existing.paid_amount || 0)
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
      total_amount: computed.total,
      status: newStatus,
      needs_resend: !!existing.sent_at,  // flag if was previously sent
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)

  if (error) return { error: error.message }

  revalidatePath(`/students/${existing.student_id}`)
  revalidatePath(`/fees/cycles/${existing.billing_cycle_id}`)
  return { success: true, newTotal: computed.total, wasOverpaid: paid > computed.total }
}