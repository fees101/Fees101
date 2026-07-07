'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'

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
  const { supabase, schoolId } = ctx

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
  const { supabase, schoolId } = ctx

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

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/students')

  return { success: true }
}

export async function updateFamilyNotes(familyId: string, studentId: string, notes: string) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { error } = await supabase
    .from('families')
    .update({ notes: notes || null })
    .eq('id', familyId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath(`/students/${studentId}`)

  return { success: true }
}

export async function updateStudentStatus(studentId: string, status: 'withdrawn' | 'graduated') {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { error } = await supabase
    .from('students')
    .update({ status })
    .eq('id', studentId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/students')

  return { success: true }
}

export async function getClassesList() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

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
  if (!schoolId) return []

  const { data: classes } = await supabase
    .from('classes')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order')

  return classes || []
}
// ============ STUDENT FEE ADJUSTMENTS ============

async function getStudentFeeContext() {
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

type FeeContext = NonNullable<Awaited<ReturnType<typeof getStudentFeeContext>>>

// Opt-in/exemption edits key off a fee_item_id — resolve its owning term first
// so a closed (read-only) term can't be mutated through the student page.
async function getCycleForFeeItemOrError(supabase: FeeContext['supabase'], schoolId: string, feeItemId: string) {
  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('billing_cycle_id')
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
  return { cycle }
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

  revalidatePath(`/students/${studentId}`)
  return { success: true }
}

export async function removeStudentExemption(studentId: string, feeItemId: string) {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

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

  revalidatePath(`/students/${studentId}`)
  return { success: true }
}

// ============ PAYMENT ACCOUNT (DVA) ============

type CreateDVAResult =
  | { error: string }
  | { success: true; alreadyExists?: boolean; accountNumber: string; bankName: string }

export async function createStudentDVA(studentId: string): Promise<CreateDVAResult> {
  const ctx = await getStudentFeeContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

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
  const params = {
    reference: studentId, // accountReference is always the student's own id — stable and unique
    accountName: fullName,
    customerEmail: `student-${studentId}@fees101.internal`,
    customerName: fullName,
  }

  let dva
  try {
    dva = await provider.createDVA(params)
  } catch (firstErr: any) {
    // Monnify's error messages (especially the generic "99") aren't
    // reliable enough to fail on the first attempt — retry once.
    await new Promise(r => setTimeout(r, 1200))
    try {
      dva = await provider.createDVA(params)
    } catch (secondErr: any) {
      // Last resort: the first attempt may have actually succeeded on
      // Monnify's side and only the response was lost (or this is the
      // losing half of a double-click race) — check before giving up.
      const existing = await provider.getDVA(studentId).catch(() => null)
      if (existing) {
        dva = existing
      } else {
        return { error: `Could not create payment account: ${secondErr?.message || firstErr?.message || 'unknown error'}` }
      }
    }
  }

  const { error: updateError } = await supabase
    .from('students')
    .update({
      provider_dva_reference: studentId,
      provider_dva_bank_code: dva.bankCode,
      provider_dva_account_number: dva.accountNumber,
      provider_dva_bank_name: dva.bankName,
      provider_dva_created_at: new Date().toISOString(),
    })
    .eq('id', studentId)
    .eq('school_id', schoolId)

  if (updateError) return { error: `Payment account created but failed to save: ${updateError.message}` }

  revalidatePath(`/students/${studentId}`)
  return { success: true, accountNumber: dva.accountNumber, bankName: dva.bankName }
}