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

type Ctx = NonNullable<Awaited<ReturnType<typeof getContext>>>

// Every fee mutation must target the term the UI actually has selected —
// never guess "the current cycle" server-side. This validates the caller's
// cycleId belongs to this school and isn't closed.
async function getCycleOrError(supabase: Ctx['supabase'], schoolId: string, cycleId: string) {
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', cycleId)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'This term is closed. Fee data is read-only.' }
  return { cycle }
}

// Opt-in/exemption mutations key off a fee_item_id, not a cycleId directly —
// resolve the owning term first so closed-term edits are rejected the same
// way every other fee mutation in this file already is.
async function getCycleForFeeItemOrError(supabase: Ctx['supabase'], schoolId: string, feeItemId: string) {
  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('billing_cycle_id')
    .eq('id', feeItemId)
    .eq('school_id', schoolId)
    .single()

  if (!feeItem) return { error: 'Fee item not found' }
  return getCycleOrError(supabase, schoolId, feeItem.billing_cycle_id)
}

export async function addFeeItem(cycleId: string, form: {
  name: string
  amount: number
  isRequired: boolean
  scope: 'one' | 'multiple' | 'all-school'
  classIds: string[]
  isDiscountable?: boolean
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  if (!form.name.trim()) return { error: 'Name is required' }
  if (form.amount <= 0) return { error: 'Amount must be greater than 0' }
  const isDiscountable = form.isDiscountable ?? true

  if (form.scope === 'all-school') {
    const { error } = await supabase.from('fee_items').insert({
      school_id: schoolId,
      billing_cycle_id: cycle.id,
      class_id: null,
      name: form.name.trim(),
      amount: form.amount,
      is_mandatory: form.isRequired,
      is_optional_extra: !form.isRequired,
      is_discountable: isDiscountable,
    })
    if (error) return { error: error.message }
  } else {
    if (form.classIds.length === 0) return { error: 'Select at least one class' }

    const rows = form.classIds.map(classId => ({
      school_id: schoolId,
      billing_cycle_id: cycle.id,
      class_id: classId,
      name: form.name.trim(),
      amount: form.amount,
      is_mandatory: form.isRequired,
      is_optional_extra: !form.isRequired,
      is_discountable: isDiscountable,
    }))

    const { error } = await supabase.from('fee_items').insert(rows)
    if (error) return { error: error.message }
  }

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true }
}

export async function addPerClassFeeItem(cycleId: string, form: {
  name: string
  amount: number
  classIds: string[]
  isDiscountable?: boolean
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  if (!form.name.trim()) return { error: 'Name is required' }
  if (form.amount <= 0) return { error: 'Amount must be greater than 0' }
  if (form.classIds.length === 0) return { error: 'Select at least one class' }

  const rows = form.classIds.map(classId => ({
    school_id: schoolId,
    billing_cycle_id: cycle.id,
    class_id: classId,
    name: form.name.trim(),
    amount: form.amount,
    is_mandatory: true,
    is_optional_extra: false,
    is_discountable: form.isDiscountable ?? true,
  }))

  const { error } = await supabase.from('fee_items').insert(rows)
  if (error) return { error: error.message }

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true, inserted: rows.length }
}

export async function addOptionalFeeItem(cycleId: string, form: {
  name: string
  amount: number
  isDiscountable?: boolean
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  if (!form.name.trim()) return { error: 'Name is required' }
  if (form.amount <= 0) return { error: 'Amount must be greater than 0' }

  const { error } = await supabase.from('fee_items').insert({
    school_id: schoolId,
    billing_cycle_id: cycle.id,
    class_id: null,
    name: form.name.trim(),
    amount: form.amount,
    is_mandatory: false,
    is_optional_extra: true,
    is_discountable: form.isDiscountable ?? true,
  })

  if (error) return { error: error.message }

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true }
}

export async function updateFeeItem(id: string, form: {
  name: string
  amount: number
  isDiscountable?: boolean
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('id, billing_cycles(status)')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!feeItem) return { error: 'Fee item not found' }
  // @ts-expect-error — joined object
  if (feeItem.billing_cycles?.status === 'closed') {
    return { error: 'This term is closed. Fee data is read-only.' }
  }

  const { error } = await supabase
    .from('fee_items')
    .update({
      name: form.name.trim(),
      amount: form.amount,
      ...(form.isDiscountable !== undefined ? { is_discountable: form.isDiscountable } : {}),
    })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/fees/structure')
  return { success: true }
}

export async function deleteFeeItem(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('id, billing_cycles(status)')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!feeItem) return { error: 'Fee item not found' }
  // @ts-expect-error — joined object
  if (feeItem.billing_cycles?.status === 'closed') {
    return { error: 'This term is closed. Fee data is read-only.' }
  }

  // Clean up opt-ins first to avoid FK errors
  await supabase
    .from('student_fee_adjustments')
    .delete()
    .eq('fee_item_id', id)

  const { error } = await supabase
    .from('fee_items')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true }
}

export async function bulkDeleteFeeItemByName(cycleId: string, name: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  // Find ALL fee items with this name (required + optional, per-class + school-wide)
  const { data: feeItems, error: findError } = await supabase
    .from('fee_items')
    .select('id')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycle.id)
    .eq('name', name)

  if (findError) return { error: findError.message }
  if (!feeItems || feeItems.length === 0) {
    return { error: 'No fee items found with that name' }
  }

  const feeItemIds = feeItems.map(f => f.id)

  // Delete opt-ins first
  const { error: optInsError } = await supabase
    .from('student_fee_adjustments')
    .delete()
    .in('fee_item_id', feeItemIds)

  if (optInsError) return { error: `Failed to remove opt-ins: ${optInsError.message}` }

  // Then delete the fee items
  const { error: deleteError } = await supabase
    .from('fee_items')
    .delete()
    .in('id', feeItemIds)

  if (deleteError) return { error: deleteError.message }

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true, deleted: feeItemIds.length }
}

// ============ OPT-IN MANAGEMENT ============

export async function getOptInsForFeeItem(feeItemId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', students: [], optedInStudentIds: [] }
  const { supabase, schoolId } = ctx

  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('id')
    .eq('id', feeItemId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!feeItem) return { error: 'Fee item not found', students: [], optedInStudentIds: [] }

  const { data: students } = await supabase
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      admission_number,
      classes!inner(id, name)
    `)
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .order('last_name')

  const { data: optIns } = await supabase
    .from('student_fee_adjustments')
    .select('student_id')
    .eq('fee_item_id', feeItemId)
    .eq('school_id', schoolId)
    .eq('adjustment_type', 'opt_in')

  return {
    students: (students || []).map(s => ({
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      admissionNumber: s.admission_number,
      // @ts-expect-error — joined object
      classId: s.classes?.id || '',
      // @ts-expect-error — joined object
      className: s.classes?.name || '',
    })),
    optedInStudentIds: (optIns || []).map(o => o.student_id),
  }
}

export async function bulkUpdateOptIns(feeItemId: string, studentIds: string[]) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  const cycleResult = await getCycleForFeeItemOrError(supabase, schoolId, feeItemId)
  if ('error' in cycleResult) return { error: cycleResult.error }

  const { data: currentOptIns } = await supabase
    .from('student_fee_adjustments')
    .select('id, student_id')
    .eq('fee_item_id', feeItemId)
    .eq('school_id', schoolId)
    .eq('adjustment_type', 'opt_in')

  const currentSet = new Set(currentOptIns?.map(o => o.student_id) || [])
  const targetSet = new Set(studentIds)

  const toRemove = (currentOptIns || []).filter(o => !targetSet.has(o.student_id))
  if (toRemove.length > 0) {
    await supabase
      .from('student_fee_adjustments')
      .delete()
      .in('id', toRemove.map(r => r.id))
      .eq('school_id', schoolId)
  }

  const toAdd = studentIds.filter(sid => !currentSet.has(sid))
  if (toAdd.length > 0) {
    const rows = toAdd.map(studentId => ({
      school_id: schoolId,
      student_id: studentId,
      fee_item_id: feeItemId,
      adjustment_type: 'opt_in',
      created_by: userId,
    }))
    await supabase.from('student_fee_adjustments').insert(rows)
  }

  revalidatePath('/fees/structure')
  return { success: true, added: toAdd.length, removed: toRemove.length }
}
// ============ EDIT FEE GROUP ============

export async function editFeeGroup(cycleId: string, form: {
  currentName: string
  newName: string
  isSchoolWide: boolean
  isOptional: boolean
  uniformAmount?: number  // If set, applies to all selected classes
  perClassAmounts?: Record<string, number>  // classId → amount (overrides uniformAmount)
  selectedClassIds: string[]  // Only for per-class groups
  isDiscountable?: boolean
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  const newName = form.newName.trim()
  if (!newName) return { error: 'Name is required' }
  if (newName.length > 100) return { error: 'Name is too long (max 100 characters)' }

  // SCHOOL-WIDE: Simple update (single row)
  if (form.isSchoolWide) {
    if (!form.uniformAmount || form.uniformAmount <= 0) {
      return { error: 'Amount must be greater than 0' }
    }

    // Find the school-wide row(s) with this name
    const { data: existingRows } = await supabase
      .from('fee_items')
      .select('id')
      .eq('school_id', schoolId)
      .eq('billing_cycle_id', cycle.id)
      .eq('name', form.currentName)
      .is('class_id', null)
      .eq('is_optional_extra', form.isOptional)
      .eq('is_mandatory', !form.isOptional)

    if (!existingRows || existingRows.length === 0) {
      return { error: 'Fee item not found' }
    }

    // Check for name conflict (a different school-wide fee with new name)
    if (newName !== form.currentName) {
      const { data: conflictCheck } = await supabase
        .from('fee_items')
        .select('id')
        .eq('school_id', schoolId)
        .eq('billing_cycle_id', cycle.id)
        .eq('name', newName)
        .is('class_id', null)
        .eq('is_optional_extra', form.isOptional)
        .limit(1)

      if (conflictCheck && conflictCheck.length > 0) {
        return { error: `A school-wide ${form.isOptional ? 'optional' : 'required'} fee named "${newName}" already exists` }
      }
    }

    const { error } = await supabase
      .from('fee_items')
      .update({
        name: newName,
        amount: form.uniformAmount,
        ...(form.isDiscountable !== undefined ? { is_discountable: form.isDiscountable } : {}),
      })
      .in('id', existingRows.map(r => r.id))

    if (error) return { error: error.message }

    revalidatePath('/fees/structure')
    revalidatePath('/fees')
    return { success: true, updated: existingRows.length, added: 0, removed: 0 }
  }

  // PER-CLASS: Full diff (add/update/remove rows)
  if (form.selectedClassIds.length === 0) {
    return { error: 'At least one class must be selected. To remove the fee entirely, use Delete all instead.' }
  }

  // Check for name conflict (a different per-class fee group with new name)
  if (newName !== form.currentName) {
    const { data: conflictCheck } = await supabase
      .from('fee_items')
      .select('id')
      .eq('school_id', schoolId)
      .eq('billing_cycle_id', cycle.id)
      .eq('name', newName)
      .not('class_id', 'is', null)
      .eq('is_optional_extra', form.isOptional)
      .limit(1)

    if (conflictCheck && conflictCheck.length > 0) {
      return { error: `A per-class ${form.isOptional ? 'optional' : 'required'} fee named "${newName}" already exists` }
    }
  }

  // Load existing rows for this group
  const { data: existingRows } = await supabase
    .from('fee_items')
    .select('id, class_id, amount, is_discountable')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycle.id)
    .eq('name', form.currentName)
    .not('class_id', 'is', null)
    .eq('is_optional_extra', form.isOptional)
    .eq('is_mandatory', !form.isOptional)

  const existingByClass = new Map<string, { id: string, amount: number, isDiscountable: boolean }>()
  existingRows?.forEach(r => {
    if (r.class_id) {
      existingByClass.set(r.class_id, { id: r.id, amount: Number(r.amount), isDiscountable: r.is_discountable !== false })
    }
  })

  const targetClassIds = new Set(form.selectedClassIds)

  // To delete: existing rows whose class is not in selected
  const toDelete = (existingRows || []).filter(r => r.class_id && !targetClassIds.has(r.class_id))

  // To add: selected classes that don't already have a row
  const toAdd = form.selectedClassIds.filter(cid => !existingByClass.has(cid))

  // To update: selected classes that already have a row (check if amount/name changed)
  const toUpdate = form.selectedClassIds.filter(cid => existingByClass.has(cid))

  // Resolve amount for each class
  function amountForClass(classId: string): number {
    const perClass = form.perClassAmounts?.[classId]
    if (perClass !== undefined && perClass > 0) return perClass
    if (form.uniformAmount && form.uniformAmount > 0) return form.uniformAmount
    // Fallback: keep existing
    return existingByClass.get(classId)?.amount || 0
  }

  // Validate all amounts > 0
  for (const classId of form.selectedClassIds) {
    if (amountForClass(classId) <= 0) {
      return { error: 'All amounts must be greater than 0' }
    }
  }

  let added = 0, updated = 0, removed = 0

  // Step 1: Delete opt-ins for rows being deleted
  if (toDelete.length > 0) {
    const deleteIds = toDelete.map(r => r.id)
    await supabase
      .from('student_fee_adjustments')
      .delete()
      .in('fee_item_id', deleteIds)

    const { error: delError } = await supabase
      .from('fee_items')
      .delete()
      .in('id', deleteIds)
    if (delError) return { error: delError.message }
    removed = deleteIds.length
  }

  // Step 2: Update existing rows (name + amount)
  for (const classId of toUpdate) {
    const existing = existingByClass.get(classId)!
    const newAmount = amountForClass(classId)
    const newIsDiscountable = form.isDiscountable ?? existing.isDiscountable
    if (newName !== form.currentName || newAmount !== existing.amount || newIsDiscountable !== existing.isDiscountable) {
      const { error: upErr } = await supabase
        .from('fee_items')
        .update({ name: newName, amount: newAmount, is_discountable: newIsDiscountable })
        .eq('id', existing.id)
      if (upErr) return { error: upErr.message }
      updated++
    }
  }

  // Step 3: Insert new rows for newly-added classes
  if (toAdd.length > 0) {
    const rows = toAdd.map(classId => ({
      school_id: schoolId,
      billing_cycle_id: cycle.id,
      class_id: classId,
      name: newName,
      amount: amountForClass(classId),
      is_mandatory: !form.isOptional,
      is_optional_extra: form.isOptional,
      is_discountable: form.isDiscountable ?? true,
    }))
    const { error: addErr } = await supabase
      .from('fee_items')
      .insert(rows)
    if (addErr) return { error: addErr.message }
    added = rows.length
  }

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true, added, updated, removed }
}

// Get full details of a fee group for editing
export async function getFeeGroupDetails(cycleId: string, currentName: string, isSchoolWide: boolean, isOptional: boolean) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', items: [] }
  const { supabase, schoolId } = ctx

  let query = supabase
    .from('fee_items')
    .select(`
      id,
      class_id,
      amount,
      is_discountable,
      classes(id, name, display_order)
    `)
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycleId)
    .eq('name', currentName)
    .eq('is_optional_extra', isOptional)
    .eq('is_mandatory', !isOptional)

  if (isSchoolWide) {
    query = query.is('class_id', null)
  } else {
    query = query.not('class_id', 'is', null)
  }

  const { data, error } = await query
  if (error) return { error: error.message, items: [] }

  // Get opt-in counts per fee_item
  const itemIds = (data || []).map(d => d.id)
  const optInCounts: Record<string, number> = {}
  if (itemIds.length > 0 && isOptional) {
    const { data: optIns } = await supabase
      .from('student_fee_adjustments')
      .select('fee_item_id')
      .in('fee_item_id', itemIds)
      .eq('adjustment_type', 'opt_in')
    optIns?.forEach(o => {
      optInCounts[o.fee_item_id] = (optInCounts[o.fee_item_id] || 0) + 1
    })
  }

  return {
    items: (data || []).map(d => ({
      id: d.id,
      classId: d.class_id,
      // @ts-expect-error — joined
      className: d.classes?.name || '',
      // @ts-expect-error — joined
      classDisplayOrder: d.classes?.display_order || 0,
      amount: Number(d.amount),
      isDiscountable: d.is_discountable !== false,
      optInCount: optInCounts[d.id] || 0,
    })),
  }
}
// ============ GROUP OPT-IN MANAGEMENT ============

// Get all students eligible for any fee_item in this group, plus current opt-ins
export async function getOptInsForFeeGroup(feeItemIds: string[]) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', students: [], optedInStudentIds: [], eligibleClassIds: [] }
  const { supabase, schoolId } = ctx

  if (feeItemIds.length === 0) {
    return { students: [], optedInStudentIds: [], eligibleClassIds: [] }
  }

  // Get the fee items to find their class scope
  const { data: feeItems } = await supabase
    .from('fee_items')
    .select('id, class_id')
    .in('id', feeItemIds)
    .eq('school_id', schoolId)

  if (!feeItems || feeItems.length === 0) return { error: 'Could not load fee items', students: [], optedInStudentIds: [], eligibleClassIds: [] }

  // Determine eligible classes (null class_id = school-wide, all students eligible)
  const hasSchoolWide = feeItems.some(f => f.class_id === null)
  const eligibleClassIds = hasSchoolWide
    ? null  // null means "all classes"
    : feeItems.map(f => f.class_id).filter(Boolean) as string[]

  // Get students — all active if school-wide, otherwise scoped to eligible classes
  let studentsQuery = supabase
    .from('students')
    .select(`
      id,
      first_name,
      last_name,
      admission_number,
      classes!inner(id, name)
    `)
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .order('last_name')

  if (eligibleClassIds && eligibleClassIds.length > 0) {
    studentsQuery = studentsQuery.in('class_id', eligibleClassIds)
  }

  const { data: students } = await studentsQuery

  // Get current opt-ins across all fee items in the group
  const { data: optIns } = await supabase
    .from('student_fee_adjustments')
    .select('student_id')
    .in('fee_item_id', feeItemIds)
    .eq('adjustment_type', 'opt_in')

  const optedInSet = new Set((optIns || []).map(o => o.student_id))

  return {
    students: (students || []).map(s => ({
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      admissionNumber: s.admission_number,
      // @ts-expect-error — joined
      classId: s.classes?.id || '',
      // @ts-expect-error — joined
      className: s.classes?.name || '',
    })),
    optedInStudentIds: Array.from(optedInSet),
    eligibleClassIds: eligibleClassIds || [],
  }
}

// Sync opt-ins across a fee group — figures out which fee_item_id matches each student's class
export async function bulkUpdateOptInsForGroup(feeItemIds: string[], studentIds: string[]) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  if (feeItemIds.length === 0) return { error: 'No fee items in group' }

  // Get fee items with their class_id
  const { data: feeItems } = await supabase
    .from('fee_items')
    .select('id, class_id, billing_cycle_id')
    .in('id', feeItemIds)
    .eq('school_id', schoolId)

  if (!feeItems || feeItems.length === 0) return { error: 'Could not load fee items' }

  const cycleResult = await getCycleOrError(supabase, schoolId, feeItems[0].billing_cycle_id)
  if ('error' in cycleResult) return { error: cycleResult.error }

  // Get all students with their class_id for matching
  const { data: allStudents } = await supabase
    .from('students')
    .select('id, class_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')

  const studentClassMap: Record<string, string | null> = {}
  allStudents?.forEach(s => {
    studentClassMap[s.id] = s.class_id || null
  })

  // For each fee item, sync its opt-ins
  for (const feeItem of feeItems) {
    // Students eligible for THIS specific fee_item
    const eligibleStudentIds = studentIds.filter(sid => {
      if (feeItem.class_id === null) return true  // school-wide — all eligible
      return studentClassMap[sid] === feeItem.class_id
    })

    // Get current opt-ins for this fee item
    const { data: currentOptIns } = await supabase
      .from('student_fee_adjustments')
      .select('id, student_id')
      .eq('fee_item_id', feeItem.id)
      .eq('school_id', schoolId)
      .eq('adjustment_type', 'opt_in')

    const currentSet = new Set(currentOptIns?.map(o => o.student_id) || [])
    const targetSet = new Set(eligibleStudentIds)

    // Remove opt-ins for students no longer in target
    const toRemove = (currentOptIns || []).filter(o => !targetSet.has(o.student_id))
    if (toRemove.length > 0) {
      await supabase
        .from('student_fee_adjustments')
        .delete()
        .in('id', toRemove.map(r => r.id))
        .eq('school_id', schoolId)
    }

    // Add new opt-ins
    const toAdd = eligibleStudentIds.filter(sid => !currentSet.has(sid))
    if (toAdd.length > 0) {
      const rows = toAdd.map(studentId => ({
        school_id: schoolId,
        student_id: studentId,
        fee_item_id: feeItem.id,
        adjustment_type: 'opt_in',
        created_by: userId,
      }))
      await supabase.from('student_fee_adjustments').insert(rows)
    }
  }

  revalidatePath('/fees/structure')
  return { success: true }
}