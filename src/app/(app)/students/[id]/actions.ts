'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission, getAuthContext, can } from '@/lib/auth/permissions'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'
import { provisionStudentDVA, ensureBulkDVAJob } from '@/lib/payments/provisionDVA'
import { sendMessageWithFallback } from '@/lib/messaging/sendMessage'
import { MessageChannel } from '@/lib/messaging/types'
import { composeReminderSMS, composeOverdueSMS } from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'
import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { applyOptInAdditionToLiveInvoice } from '@/lib/invoicing/addOptInLine'

// Shared by both "bring a cancelled current-term invoice back to life" paths:
// updateStudentStatus when the target is 'active' (reactivating a withdrawn
// or graduated student), and the standalone regenerateCancelledInvoice
// action (an active student's invoice was cancelled by mistake, or the
// school wants a corrected one for the same term). Because
// (student_id, billing_cycle_id) is unique, a cancelled
// invoice permanently occupies that slot — a fresh insert for the same
// student+cycle is never possible, cancelled or not. cancelInvoice only ever
// allows cancelling when paid_amount and credit_applied are both zero, so
// every cancelled invoice is guaranteed safe to recompute from scratch with
// no clawback risk (2026-09-16 stress test §1.3).
async function regenerateCancelledInvoiceOnReactivation(
  supabase: any,
  schoolId: string,
  studentId: string
): Promise<{ error: string } | { regeneratedInvoiceNumber: string | null }> {
  const { data: activeCycle } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .maybeSingle()
  if (!activeCycle) return { regeneratedInvoiceNumber: null }

  const { data: cancelledInvoice } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('student_id', studentId)
    .eq('billing_cycle_id', activeCycle.id)
    .eq('status', 'cancelled')
    .maybeSingle()
  if (!cancelledInvoice) return { regeneratedInvoiceNumber: null }

  // A cancelled invoice can only reach that state with zero payment and zero
  // credit applied (cancelInvoice's own guard) — safe to recompute from
  // scratch with no clawback risk.
  const computed = await computeInvoiceForStudent(
    supabase, schoolId, studentId, activeCycle.id, undefined, 0, cancelledInvoice.id
  )
  if ('error' in computed) return { error: computed.error }

  const newStatus: 'pending' | 'paid' = computed.total === 0 ? 'paid' : 'pending'
  const { error: recomputeError } = await supabase.rpc('apply_invoice_recompute', {
    p_invoice_id: cancelledInvoice.id,
    p_school_id: schoolId,
    p_student_id: studentId,
    p_line_items: computed.lineItems,
    p_subtotal: computed.subtotal,
    p_discount_amount: computed.discountAmount,
    p_discount_reason: computed.discountReason || null,
    p_previous_balance: computed.previousBalance,
    p_previous_balance_from_invoice_id: computed.previousInvoiceId,
    p_credit_applied: computed.creditApplied,
    p_total_amount: computed.total,
    p_status: newStatus,
    p_needs_resend: false,
    p_credit_delta: -computed.creditApplied,
  })
  if (recomputeError) return { error: recomputeError.message }

  if (computed.appliedDiscounts.length > 0) {
    await recordAppliedDiscounts(supabase, schoolId, studentId, cancelledInvoice.id, computed.appliedDiscounts)
  }
  return { regeneratedInvoiceNumber: cancelledInvoice.invoice_number }
}

export async function updateStudentDetails(
  studentId: string,
  formData: {
    firstName: string
    lastName: string
    admissionNumber: string
    classId: string
    admissionDate: string
    // NOTE: status is deliberately NOT editable here. Lifecycle changes
    // (withdraw/graduate/reactivate) go through updateStudentStatus, which
    // detects and offers to cancel any open current-term invoice, and, for
    // reactivation, self-heals a cancelled one. Editing status here would
    // silently bypass both. See the Danger zone in StudentSettingsTab.
  },
  // A class move changes which fee_items apply, so the current-term invoice can
  // become wrong. When that's the case we do NOT save on the first call: we
  // return the impact so the client can ask the admin to confirm. The admin's
  // "continue" re-calls this with confirmClassChange=true, and only then do we
  // save the edit AND recompute the invoice onto the new class's fees in one go.
  confirmClassChange: boolean = false
): Promise<
  | { error: string }
  | {
      // First-call result when a class move would affect a current-term
      // invoice: nothing has been saved yet, the client must confirm.
      needsConfirm: true
      oldClassName: string | null
      newClassName: string | null
      invoice: {
        id: string
        invoiceNumber: string | null
        // clean = no payment and no credit applied, safe to auto-recompute.
        // has_payment = money already on it, we won't touch it automatically.
        state: 'clean' | 'has_payment'
        currentTotal: number
        newTotal: number | null
        paidAmount: number
        creditApplied: number
      }
    }
  | {
      success: true
      // What happened to the current-term invoice as part of this save.
      invoiceOutcome: 'none' | 'regenerated' | 'needs_review'
      newInvoiceTotal: number | null
    }
> {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  // Get current student: admission_number to check for a rename conflict, plus
  // class_id/name/status/credit_balance for detecting and applying a class move.
  const { data: currentStudent } = await supabase
    .from('students')
    .select('admission_number, class_id, status, credit_balance, classes(name)')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!currentStudent) return { error: 'Student not found' }

  // If admission number changed, check uniqueness
  if (currentStudent.admission_number !== formData.admissionNumber) {
    const { data: existing } = await supabase
      .from('students')
      .select('id')
      .eq('school_id', schoolId)
      .eq('admission_number', formData.admissionNumber)
      .neq('id', studentId)
      .maybeSingle()

    if (existing) {
      return { error: `Admission number ${formData.admissionNumber} is already in use` }
    }
  }

  const oldClassId: string | null = currentStudent.class_id ?? null
  const classChanged = !!formData.classId && formData.classId !== oldClassId
  // @ts-expect-error — classes is joined
  const oldClassName: string | null = currentStudent.classes?.name ?? null
  const isActive = currentStudent.status === 'active'

  // Find the affected current-term invoice (if any). (student_id,
  // billing_cycle_id) is unique, so a student has at most one non-cancelled
  // invoice on the current active term; a class move can make its fees wrong.
  let currentInvoice: any = null
  let newClassName: string | null = null
  if (classChanged) {
    const [{ data: newClass }, { data: inv }] = await Promise.all([
      supabase
        .from('classes')
        .select('name')
        .eq('id', formData.classId)
        .eq('school_id', schoolId)
        .maybeSingle(),
      supabase
        .from('invoices')
        .select('id, invoice_number, status, total_amount, paid_amount, credit_applied, billing_cycle_id, sent_at, billing_cycles!inner(status)')
        .eq('student_id', studentId)
        .eq('school_id', schoolId)
        .eq('billing_cycles.status', 'active')
        .neq('status', 'cancelled')
        .maybeSingle(),
    ])
    newClassName = newClass?.name ?? null
    currentInvoice = inv
  }

  const invClean = currentInvoice
    ? Number(currentInvoice.paid_amount || 0) <= 0 && Number(currentInvoice.credit_applied || 0) <= 0
    : false

  // Confirmation gate: a class move that actually touches a current-term
  // invoice must be confirmed before anything is saved. Preview the projected
  // new total for a clean invoice (using the not-yet-saved class id) so the
  // admin sees the exact billing impact before deciding.
  if (classChanged && currentInvoice && !confirmClassChange) {
    let newTotal: number | null = null
    if (invClean && isActive) {
      const preview = await computeInvoiceForStudent(
        supabase,
        schoolId,
        studentId,
        currentInvoice.billing_cycle_id,
        undefined,
        0,
        currentInvoice.id,
        undefined,
        formData.classId
      )
      if (!('error' in preview)) newTotal = preview.total
    }
    return {
      needsConfirm: true,
      oldClassName,
      newClassName,
      invoice: {
        id: currentInvoice.id,
        invoiceNumber: currentInvoice.invoice_number,
        state: invClean ? 'clean' : 'has_payment',
        currentTotal: Number(currentInvoice.total_amount || 0),
        newTotal,
        paidAmount: Number(currentInvoice.paid_amount || 0),
        creditApplied: Number(currentInvoice.credit_applied || 0),
      },
    }
  }

  // Save the edit.
  const { error } = await supabase
    .from('students')
    .update({
      first_name: formData.firstName.trim(),
      last_name: formData.lastName.trim(),
      admission_number: formData.admissionNumber,
      class_id: formData.classId,
      admission_date: formData.admissionDate,
    })
    .eq('id', studentId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  // Bring the current-term invoice onto the new class's fees. A clean invoice
  // (no payment, no credit) can be recomputed with zero clawback risk, using
  // the same atomic recompute RPC the term-page regenerate uses. Anything with
  // money on it is left untouched and flagged for manual review (a refund or
  // extra charge is the admin's call, not a silent rewrite).
  let invoiceOutcome: 'none' | 'regenerated' | 'needs_review' = 'none'
  let newInvoiceTotal: number | null = null

  if (classChanged && currentInvoice) {
    if (invClean && isActive) {
      const liveCredit = Number(currentStudent.credit_balance || 0)
      const computed = await computeInvoiceForStudent(
        supabase,
        schoolId,
        studentId,
        currentInvoice.billing_cycle_id,
        liveCredit,
        0,
        currentInvoice.id
      )
      if (!('error' in computed)) {
        const newStatus: 'pending' | 'paid' = computed.total === 0 ? 'paid' : 'pending'
        const { error: recomputeError } = await supabase.rpc('apply_invoice_recompute', {
          p_invoice_id: currentInvoice.id,
          p_school_id: schoolId,
          p_student_id: studentId,
          p_line_items: computed.lineItems,
          p_subtotal: computed.subtotal,
          p_discount_amount: computed.discountAmount,
          p_discount_reason: computed.discountReason || null,
          p_previous_balance: computed.previousBalance,
          p_previous_balance_from_invoice_id: computed.previousInvoiceId,
          p_credit_applied: computed.creditApplied,
          p_total_amount: computed.total,
          p_status: newStatus,
          // If the parent already got this invoice, the numbers just changed —
          // flag it so the admin knows to resend the updated copy.
          p_needs_resend: !!currentInvoice.sent_at,
          p_credit_delta: -computed.creditApplied,
        })
        if (!recomputeError) {
          if (computed.appliedDiscounts.length > 0) {
            await recordAppliedDiscounts(supabase, schoolId, studentId, currentInvoice.id, computed.appliedDiscounts)
          }
          invoiceOutcome = 'regenerated'
          newInvoiceTotal = computed.total
        }
      }
    } else {
      invoiceOutcome = 'needs_review'
    }
  }

  const studentName = `${formData.firstName} ${formData.lastName}`.trim()
  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: classChanged ? 'student.class_changed' : 'student.updated',
    targetType: 'student',
    targetId: studentId,
    summary: classChanged
      ? `Moved ${studentName} from ${oldClassName || 'no class'} to ${newClassName || 'a new class'}`
        + (invoiceOutcome === 'regenerated' && newInvoiceTotal !== null
            ? `; invoice recalculated to ₦${newInvoiceTotal.toLocaleString()}`
            : invoiceOutcome === 'needs_review'
              ? '; current-term invoice flagged for review (payment/credit applied)'
              : '')
      : `Updated ${studentName}'s details`,
    metadata: classChanged
      ? {
          oldClassId,
          oldClassName,
          newClassId: formData.classId,
          newClassName,
          affectedInvoiceId: currentInvoice?.id ?? null,
          invoiceOutcome,
          newInvoiceTotal,
        }
      : undefined,
  })

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/students')
  if (classChanged) {
    revalidatePath('/fees/cycles')
    revalidatePath('/invoices')
    if (currentInvoice) {
      revalidatePath(`/invoices/${currentInvoice.id}`)
      revalidatePath(`/fees/cycles/${currentInvoice.billing_cycle_id}`)
    }
  }

  return { success: true, invoiceOutcome, newInvoiceTotal }
}

export async function updateFamilyInfo(familyId: string, studentId: string, formData: {
  primaryParentName: string
  primaryParentPhone: string
  primaryParentEmail: string
  secondaryParentName: string
  secondaryParentPhone: string
  secondaryParentEmail: string
}) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { error } = await supabase
    .from('families')
    .update({
      primary_parent_name: formData.primaryParentName,
      primary_parent_phone: formData.primaryParentPhone,
      primary_parent_email: formData.primaryParentEmail || null,
      secondary_parent_name: formData.secondaryParentName || null,
      secondary_parent_phone: formData.secondaryParentPhone || null,
      secondary_parent_email: formData.secondaryParentEmail || null,
    })
    .eq('id', familyId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'family.updated',
    targetType: 'family',
    targetId: familyId,
    summary: `Updated family info for ${formData.primaryParentName || familyId}`,
  })

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/students')

  return { success: true }
}

export async function updateFamilyNotes(familyId: string, studentId: string, notes: string) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { error } = await supabase
    .from('families')
    .update({ notes: notes || null })
    .eq('id', familyId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'family.notes_updated',
    targetType: 'family',
    targetId: familyId,
    summary: `Updated notes for family ${familyId}`,
  })

  revalidatePath(`/students/${studentId}`)

  return { success: true }
}

export async function updateStudentStatus(
  studentId: string,
  status: 'active' | 'withdrawn' | 'graduated'
): Promise<
  | { error: string }
  | {
      success: true
      openInvoices: { id: string; invoiceNumber: string | null; totalAmount: number; outstandingAmount: number }[]
      invoicesNeedingReview: { id: string; invoiceNumber: string | null }[]
      regeneratedInvoiceNumber: string | null
    }
> {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: currentStudent } = await supabase
    .from('students')
    .select('first_name, last_name, status, class_id')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()
  if (!currentStudent) return { error: 'Student not found' }

  // Reactivating (-> active) needs a class to bill against — everything
  // else about a withdrawn/graduated student stays untouched until then.
  if (status === 'active' && !currentStudent.class_id) {
    return { error: 'Assign this student a class before reactivating them.' }
  }

  const { error } = await supabase
    .from('students')
    .update({
      status,
      withdrawn_at: status === 'withdrawn' ? new Date().toISOString() : null,
      graduated_at: status === 'graduated' ? new Date().toISOString() : null,
    })
    .eq('id', studentId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  const openInvoices: { id: string; invoiceNumber: string | null; totalAmount: number; outstandingAmount: number }[] = []
  const invoicesNeedingReview: { id: string; invoiceNumber: string | null }[] = []
  let regeneratedInvoiceNumber: string | null = null

  if (status === 'active') {
    // Reactivation has nothing to cancel — instead, self-heal a cancelled
    // invoice from the withdraw/graduate that had (student_id,
    // billing_cycle_id)'s uniqueness permanently stranding it: a student
    // withdrawn -> cancel invoice -> reactivated could otherwise never be
    // billed for that term again (real revenue leak, 2026-09-16 stress test
    // §1.3).
    const result = await regenerateCancelledInvoiceOnReactivation(supabase, schoolId, studentId)
    if ('error' in result) return { error: result.error }
    regeneratedInvoiceNumber = result.regeneratedInvoiceNumber
  } else {
    // A student marked withdrawn/graduated mid-term may already have an
    // invoice on the current active cycle — generated before the admin got
    // round to updating their status. They won't be billed again going
    // forward (invoice generation only pulls active students), but that
    // invoice doesn't get touched automatically: the school may still want
    // the parent to finish paying what's owed for the term. Surface it so
    // the admin decides — cancel it, or leave it open and collectible.
    const { data: openInvoicesRaw } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_amount, paid_amount, credit_applied, billing_cycles!inner(status)')
      .eq('student_id', studentId)
      .eq('school_id', schoolId)
      .eq('billing_cycles.status', 'active')
      .in('status', ['pending', 'partial', 'overdue'])

    for (const inv of openInvoicesRaw || []) {
      const untouched = Number(inv.paid_amount || 0) <= 0 && Number(inv.credit_applied || 0) <= 0
      if (untouched) {
        openInvoices.push({
          id: inv.id,
          invoiceNumber: inv.invoice_number,
          totalAmount: Number(inv.total_amount),
          outstandingAmount: Number(inv.total_amount) - Number(inv.paid_amount || 0),
        })
      } else {
        // Payment or credit already applied — cancelling isn't a clean option
        // here (see cancelInvoice's guard), just flag it for manual review.
        invoicesNeedingReview.push({ id: inv.id, invoiceNumber: inv.invoice_number })
      }
    }
  }

  const studentName = `${currentStudent.first_name} ${currentStudent.last_name}`.trim()
  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.status_changed',
    targetType: 'student',
    targetId: studentId,
    summary: `Changed ${studentName}'s status from ${currentStudent.status} to ${status}`
      + (regeneratedInvoiceNumber ? `; regenerated invoice ${regeneratedInvoiceNumber}` : ''),
    metadata: {
      oldStatus: currentStudent.status,
      newStatus: status,
      openInvoiceIds: openInvoices.map(i => i.id),
      invoicesNeedingReview: invoicesNeedingReview.map(i => i.id),
      regeneratedInvoiceNumber,
    },
  })

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/students')
  revalidatePath('/fees/cycles')
  if (regeneratedInvoiceNumber) revalidatePath('/invoices')

  return { success: true, openInvoices, invoicesNeedingReview, regeneratedInvoiceNumber }
}

// Lets an admin fix a cancelled current-term invoice for a student who's
// still active (cancelled by mistake, or the fee structure changed and the
// old invoice needs replacing) — previously a dead end: StudentFeesTab could
// only say "reissuing not yet supported" because the unique (student_id,
// billing_cycle_id) constraint blocks a fresh insert. Reuses the same
// un-cancel-and-recompute path as reactivation, since a cancelled invoice is
// always financially clean (see comment above regenerateCancelledInvoiceOnReactivation).
export async function regenerateCancelledInvoice(studentId: string): Promise<
  | { error: string }
  | { success: true; regeneratedInvoiceNumber: string | null }
> {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: student } = await supabase
    .from('students')
    .select('id, first_name, last_name, status')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()
  if (!student) return { error: 'Student not found' }
  if (student.status !== 'active') {
    return { error: `Only an active student's invoice can be regenerated this way (this student is ${student.status}). Reactivate them first.` }
  }

  const result = await regenerateCancelledInvoiceOnReactivation(supabase, schoolId, studentId)
  if ('error' in result) return result
  if (!result.regeneratedInvoiceNumber) {
    return { error: 'No cancelled invoice was found for the current term.' }
  }

  const studentName = `${student.first_name} ${student.last_name}`.trim()
  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.regenerated',
    targetType: 'student',
    targetId: studentId,
    summary: `Regenerated a cancelled invoice for ${studentName} (invoice ${result.regeneratedInvoiceNumber})`,
    metadata: { regeneratedInvoiceNumber: result.regeneratedInvoiceNumber },
  })

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/invoices')
  revalidatePath('/fees/cycles')

  return { success: true, regeneratedInvoiceNumber: result.regeneratedInvoiceNumber }
}

export async function getClassesList() {
  // Just populating a dropdown — any authenticated staff member of the school
  // can see it, no specific permission required. Uses the shared, per-request
  // memoized getAuthContext() instead of a raw, unmemoized auth.getUser() call.
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return []

  const { data: classes } = await ctx.supabase
    .from('classes')
    .select('id, name')
    .eq('school_id', ctx.schoolId)
    .eq('is_active', true)
    .order('display_order')

  return classes || []
}
// ============ STUDENT FEE ADJUSTMENTS ============

async function getStudentFeeContext(perm: string = 'manage-students') {
  // Student edits/fee adjustments require manage-students by default; callers
  // pass a stricter permission where the action warrants it (e.g. revoking a
  // discount needs approve-discounts). Owner/super_admin/is_admin bypass.
  const ctx = await requirePermission(perm)
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId, role: ctx.role }
}

type FeeContext = NonNullable<Awaited<ReturnType<typeof getStudentFeeContext>>>

// Opt-in/exemption edits key off a fee_item_id — resolve its owning term first
// so a closed (read-only) term can't be mutated through the student page.
async function getCycleForFeeItemOrError(supabase: FeeContext['supabase'], schoolId: string, feeItemId: string): Promise<
  | { error: string }
  | { cycle: { id: string; status: string }; feeItemName: string }
> {
  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('name, billing_cycle_id')
    .eq('id', feeItemId)
    .eq('school_id', schoolId)
    .single()
  if (!feeItem) return { error: 'Fee item not found' }

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', feeItem.billing_cycle_id)
    .eq('school_id', schoolId)
    .single()
  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'This term is closed. Fee data is read-only.' }
  return { cycle, feeItemName: feeItem.name as string }
}

async function assertStudentInSchool(supabase: FeeContext['supabase'], schoolId: string, studentId: string) {
  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle()
  return !!student
}

export async function toggleStudentOptIn(studentId: string, feeItemId: string): Promise<
  | { error: string }
  | { success: true }
  | { success: true; deferredToNextTerm: true; overage: number; feeItemName: string }
> {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const cycleResult = await getCycleForFeeItemOrError(supabase, schoolId, feeItemId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  if (!(await assertStudentInSchool(supabase, schoolId, studentId))) return { error: 'Student not found' }

  const { data: existing } = await supabase
    .from('student_fee_adjustments')
    .select('id')
    .eq('student_id', studentId)
    .eq('fee_item_id', feeItemId)
    .eq('school_id', schoolId)
    .eq('adjustment_type', 'opt_in')
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('student_fee_adjustments')
      .delete()
      .eq('id', existing.id)
      .eq('school_id', schoolId)
    if (error) return { error: error.message }

    // If this fee is already invoiced and paid for this cycle, removing it
    // outright could claw back money the family already paid. Check before
    // treating the opt-out as fully in effect — the paid invoice itself is
    // never touched either way.
    const { data: existingInvoice } = await supabase
      .from('invoices')
      .select('id, paid_amount, credit_applied, students!inner(credit_balance)')
      .eq('student_id', studentId)
      .eq('billing_cycle_id', cycleResult.cycle.id)
      .eq('school_id', schoolId)
      .maybeSingle()

    const paid = Number(existingInvoice?.paid_amount || 0)
    if (existingInvoice && paid > 0) {
      const previouslyApplied = Number(existingInvoice.credit_applied || 0)
      // @ts-expect-error — joined
      const liveCreditBalance = Number(existingInvoice.students?.credit_balance || 0)
      const computed = await computeInvoiceForStudent(
        supabase, schoolId, studentId, cycleResult.cycle.id,
        liveCreditBalance + previouslyApplied, paid, existingInvoice.id
      )
      if (!('error' in computed) && computed.total < paid) {
        // A true clawback. Don't touch the paid invoice — put the opt-in row
        // back exactly as it was (so this term's invoice stays an accurate
        // record of what was charged and paid), but flag it so the fee
        // simply won't recur next term.
        const { error: reinsertError } = await supabase
          .from('student_fee_adjustments')
          .insert({
            school_id: schoolId,
            student_id: studentId,
            fee_item_id: feeItemId,
            adjustment_type: 'opt_in',
            created_by: userId,
            carry_forward: false,
          })
        if (reinsertError) return { error: reinsertError.message }

        const overage = paid - computed.total
        await logAuditEvent(supabase, {
          schoolId,
          actorId: userId,
          action: 'student.opt_out_deferred_paid_invoice',
          targetType: 'student',
          targetId: studentId,
          summary: `Deferred opt-out of ${cycleResult.feeItemName} to next term (already paid this term)`,
          metadata: { feeItemId, feeItemName: cycleResult.feeItemName, overage },
        })

        revalidatePath(`/students/${studentId}`)
        return { success: true, deferredToNextTerm: true, overage, feeItemName: cycleResult.feeItemName }
      }
    }
  } else {
    // Remove any conflicting exemption first
    await supabase
      .from('student_fee_adjustments')
      .delete()
      .eq('student_id', studentId)
      .eq('fee_item_id', feeItemId)
      .eq('school_id', schoolId)
      .eq('adjustment_type', 'exempt')

    const { error } = await supabase
      .from('student_fee_adjustments')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        fee_item_id: feeItemId,
        adjustment_type: 'opt_in',
        created_by: userId,
      })
    if (error) return { error: error.message }

    // Opting in is an addition — apply it to the current live invoice
    // immediately if one exists (safe regardless of sent/paid, since nothing
    // existing is touched). Opting out deliberately does NOT get a mirror
    // call here: a deduction only ever affects the next invoice generation.
    await applyOptInAdditionToLiveInvoice(supabase, schoolId, userId, studentId, feeItemId)
  }

  const newState = existing ? 'opted_out' : 'opted_in'
  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.opt_in_toggled',
    targetType: 'student',
    targetId: studentId,
    summary: `${existing ? 'Removed opt-in for' : 'Opted student in to'} ${cycleResult.feeItemName}`,
    metadata: { feeItemId, feeItemName: cycleResult.feeItemName, newState },
  })

  revalidatePath(`/students/${studentId}`)
  return { success: true }
}

// Follow-up to a deferred opt-out (toggleStudentOptIn's `deferredToNextTerm`
// branch): the fee already stopped recurring from next term, this only
// decides what happens to the amount the family already paid for it this
// term. Crediting is self-serve and safe (offsets future invoices, no money
// leaves); leaving it as-is takes no action here — it's meant for the school
// to refund manually outside the app, so it's recorded in unresolved_credits
// (not students.credit_balance, which would auto-apply it to the next
// invoice instead of giving it back) until someone marks it resolved.
export async function resolveDeferredOptOutOverage(
  studentId: string,
  feeItemId: string,
  feeItemName: string,
  decision: 'credit' | 'leave',
  overage: number
) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  if (!(await assertStudentInSchool(supabase, schoolId, studentId))) return { error: 'Student not found' }

  const roundedOverage = Math.max(0, Number(overage) || 0)
  if (decision === 'credit' && roundedOverage > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, studentId, roundedOverage)
  } else if (decision === 'leave' && roundedOverage > 0) {
    await supabase.from('unresolved_credits').insert({
      school_id: schoolId,
      student_id: studentId,
      fee_item_name: feeItemName,
      amount: roundedOverage,
      created_by: userId,
    })
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.opt_out_overage_resolved',
    targetType: 'student',
    targetId: studentId,
    summary: decision === 'credit'
      ? `Credited ₦${roundedOverage.toLocaleString()} to balance for a fee opted out after payment`
      : `Left the already-paid amount as-is for a fee opted out after payment`,
    metadata: { feeItemId, decision, overage: roundedOverage },
  })

  revalidatePath(`/students/${studentId}`)
  return { success: true }
}

// Marks a "leave as-is" opt-out overage as handled (e.g. the family was
// actually refunded in cash outside the app). Purely a record-keeping flag —
// no money moves here.
export async function resolveUnresolvedCredit(id: string) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: credit } = await supabase
    .from('unresolved_credits')
    .select('id, student_id')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()
  if (!credit) return { error: 'Not found' }

  await supabase
    .from('unresolved_credits')
    .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', id)
    .eq('school_id', schoolId)

  revalidatePath(`/students/${credit.student_id}`)
  return { success: true }
}

export async function setStudentExemption(studentId: string, feeItemId: string, notes?: string) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const cycleResult = await getCycleForFeeItemOrError(supabase, schoolId, feeItemId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  if (!(await assertStudentInSchool(supabase, schoolId, studentId))) return { error: 'Student not found' }

  const { data: existing } = await supabase
    .from('student_fee_adjustments')
    .select('id')
    .eq('student_id', studentId)
    .eq('fee_item_id', feeItemId)
    .eq('school_id', schoolId)
    .eq('adjustment_type', 'exempt')
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('student_fee_adjustments')
      .update({ notes: notes?.trim() || null })
      .eq('id', existing.id)
      .eq('school_id', schoolId)
    if (error) return { error: error.message }
  } else {
    // Remove any opt-in on same fee
    await supabase
      .from('student_fee_adjustments')
      .delete()
      .eq('student_id', studentId)
      .eq('fee_item_id', feeItemId)
      .eq('school_id', schoolId)
      .eq('adjustment_type', 'opt_in')

    const { error } = await supabase
      .from('student_fee_adjustments')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        fee_item_id: feeItemId,
        adjustment_type: 'exempt',
        notes: notes?.trim() || null,
        created_by: userId,
      })
    if (error) return { error: error.message }
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.exemption_set',
    targetType: 'student',
    targetId: studentId,
    summary: `Set an exemption on ${cycleResult.feeItemName}`,
    metadata: { feeItemId, feeItemName: cycleResult.feeItemName, notes: notes?.trim() || null },
  })

  revalidatePath(`/students/${studentId}`)
  return { success: true }
}

export async function removeStudentExemption(studentId: string, feeItemId: string) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const cycleResult = await getCycleForFeeItemOrError(supabase, schoolId, feeItemId)
  if ('error' in cycleResult) return { error: cycleResult.error }

  const { error } = await supabase
    .from('student_fee_adjustments')
    .delete()
    .eq('student_id', studentId)
    .eq('fee_item_id', feeItemId)
    .eq('school_id', schoolId)
    .eq('adjustment_type', 'exempt')

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.exemption_removed',
    targetType: 'student',
    targetId: studentId,
    summary: `Removed the exemption on ${cycleResult.feeItemName}`,
    metadata: { feeItemId, feeItemName: cycleResult.feeItemName },
  })

  revalidatePath(`/students/${studentId}`)
  return { success: true }
}

// ============ DISCOUNTS ============

type RevokeDiscountResult =
  | { error: string }
  | { success: true; fullyRemoved: boolean }

// Revoking from the student page (as opposed to /discounts, which only ever
// stops future carry-forward) can also lift the discount off THIS invoice —
// but only while there's nothing yet to unwind: not sent to the parent, and
// no payment received against it. Past that point we never touch the
// invoice's history, we just stop it recurring into future ones.
export async function revokeDiscount(discountId: string): Promise<RevokeDiscountResult> {
  // Revoking a discount changes what a family owes — same bar as approving one
  // on the /discounts page. Gated on approve-discounts (owner/admin bypass).
  const ctx = await getStudentFeeContext('approve-discounts')
  if (!ctx) return { error: 'Only staff with discount-approval permission can revoke discounts.' }
  const { supabase, schoolId, userId } = ctx

  const { data: discount } = await supabase
    .from('discounts')
    .select('id, invoice_id, student_id, category, is_recurring, status')
    .eq('id', discountId)
    .eq('school_id', schoolId)
    .single()
  if (!discount) return { error: 'Discount not found' }
  if (discount.status !== 'approved' && discount.status !== 'applied') {
    return { error: 'This discount is not currently active' }
  }
  if (discount.category === 'sibling_discount') {
    return { error: 'Sibling discounts are auto-applied and cannot be revoked directly.' }
  }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, billing_cycle_id, paid_amount, credit_applied, sent_at, status')
    .eq('id', discount.invoice_id)
    .eq('school_id', schoolId)
    .single()
  if (!invoice) return { error: 'Invoice not found' }

  const canFullyRemove = !invoice.sent_at && Number(invoice.paid_amount || 0) === 0

  if (!canFullyRemove && !discount.is_recurring) {
    return { error: 'This invoice has already been sent or paid against, so this one-off discount can no longer be removed.' }
  }

  const now = new Date().toISOString()

  if (!canFullyRemove) {
    // Sent/paid — only stop it carrying forward. This invoice's numbers
    // (already sent/paid against) are left untouched.
    const { error } = await supabase
      .from('discounts')
      .update({ is_recurring: false, updated_at: now })
      .eq('id', discountId)
    if (error) return { error: error.message }

    await logAuditEvent(supabase, {
      schoolId,
      actorId: userId,
      action: 'discount.recurring_revoked',
      targetType: 'discount',
      targetId: discountId,
      summary: `Stopped a ${discount.category || ''} discount from carrying forward for student ${discount.student_id}`,
      metadata: { invoiceId: invoice.id, studentId: discount.student_id, category: discount.category, fullyRemoved: false },
    })

    revalidatePath(`/students/${discount.student_id}`)
    return { success: true, fullyRemoved: false }
  }

  // Nothing sent or paid yet — fully lift it off this invoice and recompute.
  const { error: rejectError } = await supabase
    .from('discounts')
    .update({
      status: 'rejected',
      rejected_by: userId,
      rejected_at: now,
      rejection_reason: 'Revoked from student page before the invoice was sent',
    })
    .eq('id', discountId)
  if (rejectError) return { error: rejectError.message }

  const previouslyApplied = Number(invoice.credit_applied || 0)
  if (previouslyApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, discount.student_id, previouslyApplied)
  }

  const paid = Number(invoice.paid_amount || 0)
  const computed = await computeInvoiceForStudent(
    supabase, schoolId, discount.student_id, invoice.billing_cycle_id, undefined, paid, invoice.id
  )
  if ('error' in computed) return { error: computed.error }

  let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
  if (paid >= computed.total) newStatus = 'paid'
  else if (paid > 0) newStatus = 'partial'

  const { error: updateError } = await supabase
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
      updated_at: now,
    })
    .eq('id', invoice.id)
  if (updateError) return { error: updateError.message }

  await recordAppliedDiscounts(supabase, schoolId, discount.student_id, invoice.id, computed.appliedDiscounts)
  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, discount.student_id, -computed.creditApplied)
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'discount.recurring_revoked',
    targetType: 'discount',
    targetId: discountId,
    summary: `Revoked a ${discount.category || ''} discount and removed it from invoice ${invoice.id}`,
    metadata: { invoiceId: invoice.id, studentId: discount.student_id, category: discount.category, fullyRemoved: true },
  })

  revalidatePath(`/students/${discount.student_id}`)
  revalidatePath(`/invoices/${invoice.id}`)
  return { success: true, fullyRemoved: true }
}

// ============ PAYMENT ACCOUNT (DVA) ============

type CreateDVAResult =
  | { error: string }
  | { success: true; alreadyExists?: boolean; accountNumber: string; bankName: string }

export async function createStudentDVA(studentId: string): Promise<CreateDVAResult> {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: student } = await supabase
    .from('students')
    .select('first_name, last_name, provider_dva_reference, provider_dva_account_number, provider_dva_bank_name')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!student) return { error: 'Student not found' }

  // Already has one — not an error, just nothing to do. Covers both a stale
  // client button state and a genuine double-click race.
  if (student.provider_dva_reference) {
    return {
      success: true,
      alreadyExists: true,
      accountNumber: student.provider_dva_account_number || '',
      bankName: student.provider_dva_bank_name || '',
    }
  }

  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) return { error: 'This school has no payment provider configured yet.' }

  const fullName = `${student.first_name} ${student.last_name}`.trim()
  try {
    const dva = await provisionStudentDVA(supabase, schoolId, provider, studentId, fullName)

    await logAuditEvent(supabase, {
      schoolId,
      actorId: userId,
      action: 'student.dva_created',
      targetType: 'student',
      targetId: studentId,
      summary: `Created a payment account for ${fullName}`,
      metadata: { accountNumber: dva.accountNumber, bankName: dva.bankName },
    })

    revalidatePath(`/students/${studentId}`)
    return { success: true, accountNumber: dva.accountNumber, bankName: dva.bankName }
  } catch (err: any) {
    return { error: err?.message || 'Could not create payment account' }
  }
}

export async function startBulkDVAJob() {
  // Triggered from the payment settings page's bulk-provision button (and CSV
  // import's phase 2), not a student-editing flow — gate on the same
  // permission as the rest of that page (manage-payment-config).
  const ctx = await getStudentFeeContext('manage-payment-config')
  if (!ctx) return { error: 'Not authenticated' }

  const result = await ensureBulkDVAJob(ctx.supabase, ctx.schoolId, ctx.userId)
  if ('error' in result) return result
  return { success: true, ...result }
}

// ============ MANUAL REMINDER ============

type SendManualReminderResult =
  | { error: string }
  | { success: true; channelUsed: MessageChannel | null; to: string }

export async function sendManualReminder(
  studentId: string,
  channelOverride?: MessageChannel
): Promise<SendManualReminderResult> {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  const authCtx = await getAuthContext()

  const { data: student } = await supabase
    .from('students')
    .select(`
      id, first_name, last_name, provider_dva_account_number,
      families(primary_parent_phone)
    `)
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

  if (!student) return { error: 'Student not found' }

  const family: any = student.families
  const phone: string | undefined = family?.primary_parent_phone
  if (!phone) return { error: 'No parent phone number on file for this student.' }
  if (!student.provider_dva_account_number) return { error: 'No payment account provisioned for this student yet.' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, outstanding_amount, sent_at, needs_resend, status, billing_cycles!inner(name, due_date, status)')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
    .gt('outstanding_amount', 0)
    .neq('billing_cycles.status', 'closed')
    .not('billing_cycles.due_date', 'is', null)
    .order('due_date', { foreignTable: 'billing_cycles', ascending: true })
    .limit(1)
    .maybeSingle()

  if (!invoice) return { error: 'No outstanding invoice with a due date for this student.' }

  // Stale invoices are never sendable — the SMS balance comes straight off
  // this row, so texting it now would give the parent an outdated amount.
  // Regenerate the invoice first.
  if (invoice.needs_resend) return { error: 'This invoice is out of date. Update it before sending.' }

  // Sending an invoice for the first time is part of "generate & send
  // invoices" — same gate as generating/regenerating it. A reminder or
  // receipt about an invoice already sent stays under manage-students.
  const isFirstSend = !invoice.sent_at && invoice.status !== 'paid'
  if (isFirstSend && !can(authCtx, 'manage-invoices')) return { error: 'Not authorized' }

  const { data: school } = await supabase.from('schools').select('name, settings').eq('id', schoolId).single()

  const dueDate: string = (invoice.billing_cycles as any).due_date
  const isOverdue = new Date(dueDate) < new Date()
  const messageParams = {
    studentName: `${student.first_name} ${student.last_name}`.trim(),
    termName: (invoice.billing_cycles as any).name || '',
    balance: Number(invoice.outstanding_amount),
    dueDate,
    accountNumber: student.provider_dva_account_number,
  }
  const smsText = (isOverdue ? composeOverdueSMS : composeReminderSMS)({
    ...messageParams,
    schoolName: getSchoolSmsName(school),
  })

  const result = await sendMessageWithFallback(
    { supabase, schoolId, messageType: isOverdue ? 'reminder_overdue' : 'reminder_due', studentId, invoiceId: invoice.id },
    { phone },
    { sms: smsText },
    channelOverride ? { channelOrder: [channelOverride] } : undefined
  )

  if (!result.ok) return { error: 'Failed to send on every available channel — check the notification banner for details.' }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.reminder_sent',
    targetType: 'student',
    targetId: studentId,
    summary: `Sent a manual reminder to ${messageParams.studentName || studentId}'s parent`,
    metadata: { invoiceId: invoice.id, channelUsed: result.channelUsed, to: phone },
  })

  revalidatePath(`/students/${studentId}`)
  return { success: true, channelUsed: result.channelUsed, to: phone }
}