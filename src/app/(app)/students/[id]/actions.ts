'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission, getAuthContext } from '@/lib/auth/permissions'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'
import { provisionStudentDVA } from '@/lib/payments/provisionDVA'
import { sendMessageWithFallback } from '@/lib/messaging/sendMessage'
import { MessageChannel } from '@/lib/messaging/types'
import { composeReminderSMS, composeOverdueSMS } from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'
import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'
import { logAuditEvent } from '@/lib/audit/logAudit'

export async function updateStudentDetails(studentId: string, formData: {
  firstName: string
  lastName: string
  admissionNumber: string
  classId: string
  admissionDate: string
  status: string
}) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  // Get current student to check admission number conflicts
  const { data: currentStudent } = await supabase
    .from('students')
    .select('admission_number')
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

  const { error } = await supabase
    .from('students')
    .update({
      first_name: formData.firstName,
      last_name: formData.lastName,
      admission_number: formData.admissionNumber,
      class_id: formData.classId,
      admission_date: formData.admissionDate,
      status: formData.status,
    })
    .eq('id', studentId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.updated',
    targetType: 'student',
    targetId: studentId,
    summary: `Updated ${`${formData.firstName} ${formData.lastName}`.trim()}'s details`,
  })

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/students')

  return { success: true }
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

export async function updateStudentStatus(studentId: string, status: 'withdrawn' | 'graduated') {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: currentStudent } = await supabase
    .from('students')
    .select('first_name, last_name, status')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()

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

  const studentName = currentStudent ? `${currentStudent.first_name} ${currentStudent.last_name}`.trim() : studentId
  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.status_changed',
    targetType: 'student',
    targetId: studentId,
    summary: `Changed ${studentName}'s status from ${currentStudent?.status || 'unknown'} to ${status}`,
    metadata: { oldStatus: currentStudent?.status || null, newStatus: status },
  })

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/students')

  return { success: true }
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
async function getCycleForFeeItemOrError(supabase: FeeContext['supabase'], schoolId: string, feeItemId: string) {
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

export async function toggleStudentOptIn(studentId: string, feeItemId: string) {
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

type BulkDVAResult =
  | { error: string }
  | { success: true; created: number; failed: number; remaining: number; failures: { name: string; error: string }[] }

// Provision ONE batch of virtual accounts for active students that don't have
// one yet, then report how many still remain. The client calls this repeatedly
// (a batch at a time, with a progress bar) so onboarding a 300+ student school
// never runs as one giant request that would blow past serverless/HTTP time
// limits. Reuses the provider's cached auth token, so per-student calls stay cheap.
export async function createDVAsForAllStudents(batchSize = 25): Promise<BulkDVAResult> {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) return { error: 'This school has no payment provider configured yet.' }

  const limit = Math.max(1, Math.min(batchSize, 50))
  const { data: students, error } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .is('provider_dva_reference', null)
    .limit(limit)

  if (error) return { error: error.message }

  let created = 0
  const failures: { name: string; error: string }[] = []
  for (const s of students || []) {
    const fullName = `${s.first_name} ${s.last_name}`.trim()
    try {
      await provisionStudentDVA(supabase, schoolId, provider, s.id, fullName)
      created++
    } catch (err: any) {
      failures.push({ name: fullName || s.id, error: err?.message || 'unknown error' })
    }
  }

  // How many active students still lack an account after this batch — tells the
  // client whether to keep looping.
  const { count: remaining } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .is('provider_dva_reference', null)

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.dva_bulk_created',
    targetType: 'student',
    summary: `Created ${created} payment accounts (${failures.length} failed)`,
    metadata: { count: created, failures: failures.length },
  })

  revalidatePath('/settings/payments')
  revalidatePath('/students')
  return { success: true, created, failed: failures.length, remaining: remaining ?? 0, failures }
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
    .select('id, outstanding_amount, billing_cycles!inner(name, due_date, status)')
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