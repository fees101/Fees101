'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { type BillingFrequency, isRecurringFromFrequency, frequencyFromRow } from '@/lib/fees/billingFrequency'

async function getContext() {
  // Gated on the 'manage-fee-structure' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-fee-structure')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

type Ctx = NonNullable<Awaited<ReturnType<typeof getContext>>>

// Every fee mutation must target the term the UI actually has selected —
// never guess "the current cycle" server-side. This validates the caller's
// cycleId belongs to this school and isn't closed.
async function getCycleOrError(supabase: Ctx['supabase'], schoolId: string, cycleId: string) {
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status, name')
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
  // When set, each selected class is billed its own amount (the matrix mental
  // model — Tuition can be ₦142k for Primary and ₦248k for SS in one add).
  // Falls back to `amount` for any class not present in the map. Ignored for
  // all-school scope, which is a single row with one price.
  perClassAmounts?: Record<string, number>
  isDiscountable?: boolean
  billingFrequency?: BillingFrequency
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  if (!form.name.trim()) return { error: 'Name is required' }
  const isDiscountable = form.isDiscountable ?? true
  const billingFrequency = form.billingFrequency ?? 'per_term'
  const isRecurring = isRecurringFromFrequency(billingFrequency)
  const name = form.name.trim()

  // Per-class pricing only applies when the fee targets specific classes.
  const usePerClass = form.scope !== 'all-school'
    && !!form.perClassAmounts
    && Object.keys(form.perClassAmounts).length > 0

  // The amount charged to a given class: its own entry when in per-class mode,
  // otherwise the single uniform amount.
  const amountForClass = (classId: string): number => {
    if (usePerClass) {
      const a = form.perClassAmounts![classId]
      if (a !== undefined && a > 0) return a
    }
    return form.amount
  }

  let scopeSummary = 'school-wide'
  let insertedIds: string[] = []

  if (form.scope === 'all-school') {
    if (form.amount <= 0) return { error: 'Amount must be greater than 0' }
    const { data: inserted, error } = await supabase.from('fee_items').insert({
      school_id: schoolId,
      billing_cycle_id: cycle.id,
      class_id: null,
      name,
      amount: form.amount,
      is_mandatory: form.isRequired,
      is_optional_extra: !form.isRequired,
      is_discountable: isDiscountable,
      is_recurring: isRecurring,
      billing_frequency: billingFrequency,
    }).select('id')
    if (error) return { error: error.message }
    insertedIds = (inserted || []).map(r => r.id)
  } else {
    if (form.classIds.length === 0) return { error: 'Select at least one class' }
    // Every class must resolve to a positive amount, whether uniform or its own.
    for (const classId of form.classIds) {
      if (amountForClass(classId) <= 0) {
        return { error: 'Every selected class needs an amount greater than 0' }
      }
    }

    const rows = form.classIds.map(classId => ({
      school_id: schoolId,
      billing_cycle_id: cycle.id,
      class_id: classId,
      name,
      amount: amountForClass(classId),
      is_mandatory: form.isRequired,
      is_optional_extra: !form.isRequired,
      is_discountable: isDiscountable,
      is_recurring: isRecurring,
      billing_frequency: billingFrequency,
    }))

    const { data: inserted, error } = await supabase.from('fee_items').insert(rows).select('id')
    if (error) return { error: error.message }
    insertedIds = (inserted || []).map(r => r.id)

    const { data: classRows } = await supabase.from('classes').select('name').in('id', form.classIds)
    scopeSummary = (classRows || []).map((c: { name: string }) => c.name).join(', ') || `${form.classIds.length} class(es)`
  }

  const amountSummary = usePerClass && form.scope !== 'all-school'
    ? 'per-class amounts'
    : `₦${form.amount.toLocaleString()}`

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'fee_item.added',
    targetType: 'fee_item',
    targetId: insertedIds[0],
    summary: `Added fee item ${name} (${amountSummary}) to ${scopeSummary}`,
    metadata: { name, amount: usePerClass ? undefined : form.amount, perClassAmounts: usePerClass ? form.perClassAmounts : undefined, isRequired: form.isRequired, scope: form.scope, classIds: form.classIds, cycleId: cycle.id, insertedIds },
  })

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true }
}

// Copy the fee structure from the term that ran immediately before this one
// into the (open) target term — the "Copy from last term" convenience on the
// structure page, for standing up a new term's fees without retyping them.
// Only the fee definitions are copied; per-student opt-ins are term-specific
// and are never carried over here. Fees that already exist in the target
// (same name + class + required/optional) are skipped, so copying twice is safe.
export async function copyFeesFromLastTerm(cycleId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  // The target term's own start_date anchors "the term before this one".
  const { data: target } = await supabase
    .from('billing_cycles')
    .select('id, start_date')
    .eq('id', cycle.id)
    .eq('school_id', schoolId)
    .single()
  if (!target) return { error: 'Term not found' }

  // Previous term = the most recent term that started before this one.
  const { data: prev } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .lt('start_date', target.start_date)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!prev) return { error: 'There is no earlier term to copy from.' }

  const { data: sourceFees } = await supabase
    .from('fee_items')
    .select('class_id, name, amount, is_mandatory, is_optional_extra, is_discountable, is_recurring, billing_frequency, display_order')
    .eq('billing_cycle_id', prev.id)
    .eq('school_id', schoolId)
  if (!sourceFees || sourceFees.length === 0) {
    return { error: `${prev.name} has no fees to copy.` }
  }

  // Skip anything already in this term so a second copy is a no-op, not a
  // duplicate. Identity = name + class + required/optional.
  const { data: existing } = await supabase
    .from('fee_items')
    .select('name, class_id, is_optional_extra')
    .eq('billing_cycle_id', cycle.id)
    .eq('school_id', schoolId)
  const keyFor = (name: string, classId: string | null, isOptional: boolean) =>
    `${name}::${classId ?? 'null'}::${isOptional}`
  const existingKeys = new Set(
    (existing || []).map(e => keyFor(e.name, e.class_id, e.is_optional_extra))
  )

  const toInsert = sourceFees
    .filter(f => !existingKeys.has(keyFor(f.name, f.class_id, f.is_optional_extra)))
    .map(f => ({
      school_id: schoolId,
      billing_cycle_id: cycle.id,
      class_id: f.class_id,
      name: f.name,
      amount: f.amount,
      is_mandatory: f.is_mandatory,
      is_optional_extra: f.is_optional_extra,
      is_discountable: f.is_discountable,
      is_recurring: f.is_recurring,
      billing_frequency: frequencyFromRow(f),
      display_order: f.display_order || 0,
    }))

  if (toInsert.length === 0) {
    return { error: `Every fee from ${prev.name} is already in this term.` }
  }

  const { error } = await supabase.from('fee_items').insert(toInsert)
  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'fee_item.copied_from_term',
    targetType: 'billing_cycle',
    targetId: cycle.id,
    summary: `Copied ${toInsert.length} fee item(s) from ${prev.name} into ${cycle.name}`,
    metadata: { fromCycleId: prev.id, fromTerm: prev.name, toCycleId: cycle.id, copied: toInsert.length },
  })

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true, copied: toInsert.length, fromTerm: prev.name }
}

export async function addPerClassFeeItem(cycleId: string, form: {
  name: string
  amount: number
  classIds: string[]
  isDiscountable?: boolean
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  if (!form.name.trim()) return { error: 'Name is required' }
  if (form.amount <= 0) return { error: 'Amount must be greater than 0' }
  if (form.classIds.length === 0) return { error: 'Select at least one class' }
  const name = form.name.trim()

  const rows = form.classIds.map(classId => ({
    school_id: schoolId,
    billing_cycle_id: cycle.id,
    class_id: classId,
    name,
    amount: form.amount,
    is_mandatory: true,
    is_optional_extra: false,
    is_discountable: form.isDiscountable ?? true,
  }))

  const { error } = await supabase.from('fee_items').insert(rows)
  if (error) return { error: error.message }

  const { data: classRows } = await supabase.from('classes').select('name').in('id', form.classIds)
  const scopeSummary = (classRows || []).map((c: { name: string }) => c.name).join(', ') || `${form.classIds.length} class(es)`

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'fee_item.added',
    targetType: 'fee_item',
    summary: `Added per-class fee item ${name} (₦${form.amount.toLocaleString()}) to ${scopeSummary}`,
    metadata: { name, amount: form.amount, classIds: form.classIds, cycleId: cycle.id },
  })

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true, inserted: rows.length }
}

export async function addOptionalFeeItem(cycleId: string, form: {
  name: string
  amount: number
  isDiscountable?: boolean
  billingFrequency?: BillingFrequency
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  const cycleResult = await getCycleOrError(supabase, schoolId, cycleId)
  if ('error' in cycleResult) return { error: cycleResult.error }
  const { cycle } = cycleResult

  if (!form.name.trim()) return { error: 'Name is required' }
  if (form.amount <= 0) return { error: 'Amount must be greater than 0' }
  const name = form.name.trim()
  const billingFrequency = form.billingFrequency ?? 'per_term'

  const { data, error } = await supabase.from('fee_items').insert({
    school_id: schoolId,
    billing_cycle_id: cycle.id,
    class_id: null,
    name,
    amount: form.amount,
    is_mandatory: false,
    is_optional_extra: true,
    is_discountable: form.isDiscountable ?? true,
    is_recurring: isRecurringFromFrequency(billingFrequency),
    billing_frequency: billingFrequency,
  }).select('id').single()

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'fee_item.added',
    targetType: 'fee_item',
    targetId: data?.id,
    summary: `Added optional fee item ${name} (₦${form.amount.toLocaleString()}), school-wide`,
    metadata: { name, amount: form.amount, cycleId: cycle.id },
  })

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true }
}

export async function updateFeeItem(id: string, form: {
  name: string
  amount: number
  isDiscountable?: boolean
  billingFrequency?: BillingFrequency
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('id, name, amount, billing_cycles(status)')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!feeItem) return { error: 'Fee item not found' }
  // @ts-expect-error — joined object
  if (feeItem.billing_cycles?.status === 'closed') {
    return { error: 'This term is closed. Fee data is read-only.' }
  }

  const name = form.name.trim()

  const { error } = await supabase
    .from('fee_items')
    .update({
      name,
      amount: form.amount,
      ...(form.isDiscountable !== undefined ? { is_discountable: form.isDiscountable } : {}),
      ...(form.billingFrequency !== undefined ? {
        billing_frequency: form.billingFrequency,
        is_recurring: isRecurringFromFrequency(form.billingFrequency),
      } : {}),
    })
    .eq('id', id)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'fee_item.updated',
    targetType: 'fee_item',
    targetId: id,
    summary: `Updated fee item ${feeItem.name} to ${name} (₦${form.amount.toLocaleString()})`,
    metadata: { previousName: feeItem.name, previousAmount: feeItem.amount, newName: name, newAmount: form.amount },
  })

  revalidatePath('/fees/structure')
  return { success: true }
}

export async function deleteFeeItem(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('id, name, billing_cycles(status)')
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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'fee_item.deleted',
    targetType: 'fee_item',
    targetId: id,
    summary: `Deleted fee item ${feeItem.name}`,
  })

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true }
}

export async function bulkDeleteFeeItemByName(cycleId: string, name: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'fee_item.bulk_deleted',
    targetType: 'fee_item',
    summary: `Deleted all ${feeItemIds.length} fee item(s) named ${name} from term ${cycle.name}`,
    metadata: { name, count: feeItemIds.length, cycleId: cycle.id, feeItemIds },
  })

  revalidatePath('/fees/structure')
  revalidatePath('/fees')
  return { success: true, deleted: feeItemIds.length }
}

// ============ OPT-IN MANAGEMENT ============

function mapOptInStudentRows(data: any[] | null): OptInStudentRow[] {
  return (data || []).map(s => ({
    id: s.id,
    firstName: s.first_name,
    lastName: s.last_name,
    admissionNumber: s.admission_number,
    classId: s.classes?.id || '',
    className: s.classes?.name || '',
  }))
}

// classId/active per student id, used to compute the running opt-in total
// and eligibility for students that may not be on the currently-loaded page.
async function fetchStudentClassInfo(supabase: Ctx['supabase'], schoolId: string, ids: string[]): Promise<Record<string, { classId: string | null; active: boolean }>> {
  if (ids.length === 0) return {}
  const { data } = await supabase.from('students').select('id, class_id, status').eq('school_id', schoolId).in('id', ids)
  const map: Record<string, { classId: string | null; active: boolean }> = {}
  for (const row of data || []) map[row.id] = { classId: row.class_id, active: row.status === 'active' }
  return map
}

// Same escaping rationale as students.ts's sanitizeSearchTerm — Postgrest's
// or()/and() grammar uses "," and "()" as operators, so free-text search
// strips them rather than trying to escape them (a school admin typing a
// comma means it literally).
function sanitizeOptInSearch(raw: string): string {
  return raw.trim().replace(/[,()]/g, '')
}

function optInSearchClause(term: string): string {
  const t = `%${term}%`
  return [`first_name.ilike.${t}`, `last_name.ilike.${t}`, `admission_number.ilike.${t}`].join(',')
}

export interface OptInStudentRow {
  id: string
  firstName: string
  lastName: string
  admissionNumber: string
  classId: string
  className: string
}

export interface OptInsPageParams {
  page: number
  perPage: number
  search: string
  classId: string | null
}

export interface OptInsPageResult {
  error?: string
  students: OptInStudentRow[]
  total: number
}

// Everything about *who's already opted in* — fetched once when the panel
// opens, independent of pagination, so navigating pages/search never
// clobbers in-progress (unsaved) selections with server truth again.
export interface OptInsSummaryResult {
  error?: string
  eligibleTotal: number
  optedInStudentIds: string[]
  // classId per opted-in student — needed to compute the running total for a
  // student who isn't on the currently-loaded page. A student no longer
  // eligible (moved class / archived since they opted in) has classId null;
  // Save still preserves their row (see bulkUpdateOptIns's outsideScope
  // handling), it's just excluded from the eligible/total counts.
  optedInClassMap: Record<string, string | null>
  eligibleClassIds: string[] | null
}

export interface EligibleIdsParams {
  search: string
  classId: string | null
}

export interface EligibleIdsResult {
  error?: string
  ids: { id: string; classId: string }[]
}

export async function getOptInsSummaryForFeeItem(feeItemId: string): Promise<OptInsSummaryResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', eligibleTotal: 0, optedInStudentIds: [], optedInClassMap: {}, eligibleClassIds: null }
  const { supabase, schoolId } = ctx

  const { data: feeItem } = await supabase
    .from('fee_items').select('id').eq('id', feeItemId).eq('school_id', schoolId).maybeSingle()
  if (!feeItem) return { error: 'Fee item not found', eligibleTotal: 0, optedInStudentIds: [], optedInClassMap: {}, eligibleClassIds: null }

  const { count: eligibleTotal } = await supabase
    .from('students').select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId).eq('status', 'active')

  const { data: optIns } = await supabase
    .from('student_fee_adjustments').select('student_id')
    .eq('fee_item_id', feeItemId).eq('school_id', schoolId).eq('adjustment_type', 'opt_in')
  const optedInStudentIds = (optIns || []).map(o => o.student_id)

  const info = await fetchStudentClassInfo(supabase, schoolId, optedInStudentIds)
  const optedInClassMap: Record<string, string | null> = {}
  for (const id of optedInStudentIds) {
    optedInClassMap[id] = info[id]?.active ? info[id].classId : null
  }

  return { eligibleTotal: eligibleTotal || 0, optedInStudentIds, optedInClassMap, eligibleClassIds: null }
}

export async function getOptInsPageForFeeItem(feeItemId: string, params: OptInsPageParams): Promise<OptInsPageResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', students: [], total: 0 }
  const { supabase, schoolId } = ctx

  const { data: feeItem } = await supabase
    .from('fee_items').select('id').eq('id', feeItemId).eq('school_id', schoolId).maybeSingle()
  if (!feeItem) return { error: 'Fee item not found', students: [], total: 0 }

  let q = supabase.from('students')
    .select('id, first_name, last_name, admission_number, classes!inner(id, name)', { count: 'exact' })
    .eq('school_id', schoolId).eq('status', 'active')
  if (params.classId) q = q.eq('class_id', params.classId)
  const search = sanitizeOptInSearch(params.search)
  if (search) q = q.or(optInSearchClause(search))
  q = q.order('last_name').range((params.page - 1) * params.perPage, params.page * params.perPage - 1)

  const { data, count } = await q
  return { students: mapOptInStudentRows(data), total: count || 0 }
}

export async function getEligibleIdsForFeeItem(feeItemId: string, params: EligibleIdsParams): Promise<EligibleIdsResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', ids: [] }
  const { supabase, schoolId } = ctx

  const { data: feeItem } = await supabase
    .from('fee_items').select('id').eq('id', feeItemId).eq('school_id', schoolId).maybeSingle()
  if (!feeItem) return { error: 'Fee item not found', ids: [] }

  let q = supabase.from('students').select('id, class_id').eq('school_id', schoolId).eq('status', 'active')
  if (params.classId) q = q.eq('class_id', params.classId)
  const search = sanitizeOptInSearch(params.search)
  if (search) q = q.or(optInSearchClause(search))

  const { data } = await q
  return { ids: (data || []).map(s => ({ id: s.id, classId: s.class_id })) }
}

export async function bulkUpdateOptIns(feeItemId: string, studentIds: string[]) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  const cycleResult = await getCycleForFeeItemOrError(supabase, schoolId, feeItemId)
  if ('error' in cycleResult) return { error: cycleResult.error }

  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('name')
    .eq('id', feeItemId)
    .eq('school_id', schoolId)
    .maybeSingle()

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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.opt_in_bulk_updated',
    targetType: 'fee_item',
    targetId: feeItemId,
    summary: `Updated opt-ins for ${feeItem?.name || 'fee item'}: ${toAdd.length} added, ${toRemove.length} removed`,
    metadata: { feeItemId, added: toAdd.length, removed: toRemove.length },
  })

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
  billingFrequency?: BillingFrequency
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
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
        ...(form.billingFrequency !== undefined ? {
          billing_frequency: form.billingFrequency,
          is_recurring: isRecurringFromFrequency(form.billingFrequency),
        } : {}),
      })
      .in('id', existingRows.map(r => r.id))

    if (error) return { error: error.message }

    await logAuditEvent(supabase, {
      schoolId,
      actorId: userId,
      action: 'fee_group.updated',
      targetType: 'fee_group',
      summary: `Updated fee group ${form.currentName}${newName !== form.currentName ? ` to ${newName}` : ''} (₦${form.uniformAmount.toLocaleString()}, school-wide)`,
      metadata: { cycleId: cycle.id, currentName: form.currentName, newName, amount: form.uniformAmount, isSchoolWide: true, isOptional: form.isOptional },
    })

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
    .select('id, class_id, amount, is_discountable, is_recurring, billing_frequency')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', cycle.id)
    .eq('name', form.currentName)
    .not('class_id', 'is', null)
    .eq('is_optional_extra', form.isOptional)
    .eq('is_mandatory', !form.isOptional)

  const existingByClass = new Map<string, { id: string, amount: number, isDiscountable: boolean, billingFrequency: BillingFrequency }>()
  existingRows?.forEach(r => {
    if (r.class_id) {
      existingByClass.set(r.class_id, { id: r.id, amount: Number(r.amount), isDiscountable: r.is_discountable !== false, billingFrequency: frequencyFromRow(r) })
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
    const newBillingFrequency = form.billingFrequency ?? existing.billingFrequency
    if (newName !== form.currentName || newAmount !== existing.amount || newIsDiscountable !== existing.isDiscountable || newBillingFrequency !== existing.billingFrequency) {
      const { error: upErr } = await supabase
        .from('fee_items')
        .update({ name: newName, amount: newAmount, is_discountable: newIsDiscountable, billing_frequency: newBillingFrequency, is_recurring: isRecurringFromFrequency(newBillingFrequency) })
        .eq('id', existing.id)
      if (upErr) return { error: upErr.message }
      updated++
    }
  }

  // Step 3: Insert new rows for newly-added classes
  if (toAdd.length > 0) {
    const addFrequency = form.billingFrequency ?? 'per_term'
    const rows = toAdd.map(classId => ({
      school_id: schoolId,
      billing_cycle_id: cycle.id,
      class_id: classId,
      name: newName,
      amount: amountForClass(classId),
      is_mandatory: !form.isOptional,
      is_optional_extra: form.isOptional,
      is_discountable: form.isDiscountable ?? true,
      is_recurring: isRecurringFromFrequency(addFrequency),
      billing_frequency: addFrequency,
    }))
    const { error: addErr } = await supabase
      .from('fee_items')
      .insert(rows)
    if (addErr) return { error: addErr.message }
    added = rows.length
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'fee_group.updated',
    targetType: 'fee_group',
    summary: `Updated fee group ${form.currentName}${newName !== form.currentName ? ` to ${newName}` : ''} across ${form.selectedClassIds.length} class(es) (${added} added, ${updated} updated, ${removed} removed)`,
    metadata: { cycleId: cycle.id, currentName: form.currentName, newName, isSchoolWide: false, isOptional: form.isOptional, added, updated, removed, selectedClassIds: form.selectedClassIds },
  })

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
      is_recurring,
      billing_frequency,
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
      isRecurring: d.is_recurring !== false,
      billingFrequency: frequencyFromRow(d),
      optInCount: optInCounts[d.id] || 0,
    })),
  }
}
// ============ GROUP OPT-IN MANAGEMENT ============

// Get all students eligible for any fee_item in this group, plus current opt-ins
// Resolves which classes are eligible for a fee-item group: null means
// "all classes" (at least one item in the group is school-wide), otherwise
// the union of classes covered by the group's per-class items.
async function resolveGroupEligibility(supabase: Ctx['supabase'], schoolId: string, feeItemIds: string[]): Promise<{ error?: string; eligibleClassIds: string[] | null }> {
  const { data: feeItems } = await supabase
    .from('fee_items').select('id, class_id').in('id', feeItemIds).eq('school_id', schoolId)
  if (!feeItems || feeItems.length === 0) return { error: 'Could not load fee items', eligibleClassIds: null }
  const hasSchoolWide = feeItems.some(f => f.class_id === null)
  return { eligibleClassIds: hasSchoolWide ? null : (feeItems.map(f => f.class_id).filter(Boolean) as string[]) }
}

export async function getOptInsSummaryForFeeGroup(feeItemIds: string[]): Promise<OptInsSummaryResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', eligibleTotal: 0, optedInStudentIds: [], optedInClassMap: {}, eligibleClassIds: null }
  const { supabase, schoolId } = ctx
  if (feeItemIds.length === 0) return { eligibleTotal: 0, optedInStudentIds: [], optedInClassMap: {}, eligibleClassIds: [] }

  const scope = await resolveGroupEligibility(supabase, schoolId, feeItemIds)
  if (scope.error) return { error: scope.error, eligibleTotal: 0, optedInStudentIds: [], optedInClassMap: {}, eligibleClassIds: null }
  const { eligibleClassIds } = scope

  let countQuery = supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'active')
  if (eligibleClassIds && eligibleClassIds.length > 0) countQuery = countQuery.in('class_id', eligibleClassIds)
  const { count: eligibleTotal } = await countQuery

  const { data: optIns } = await supabase
    .from('student_fee_adjustments').select('student_id')
    .in('fee_item_id', feeItemIds).eq('school_id', schoolId).eq('adjustment_type', 'opt_in')
  const optedInStudentIds = Array.from(new Set((optIns || []).map(o => o.student_id)))

  const info = await fetchStudentClassInfo(supabase, schoolId, optedInStudentIds)
  const optedInClassMap: Record<string, string | null> = {}
  for (const id of optedInStudentIds) {
    const rec = info[id]
    const eligible = !!rec?.active && (eligibleClassIds === null || (!!rec.classId && eligibleClassIds.includes(rec.classId)))
    optedInClassMap[id] = eligible ? rec!.classId : null
  }

  return { eligibleTotal: eligibleTotal || 0, optedInStudentIds, optedInClassMap, eligibleClassIds: eligibleClassIds || [] }
}

export async function getOptInsPageForFeeGroup(feeItemIds: string[], params: OptInsPageParams): Promise<OptInsPageResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', students: [], total: 0 }
  const { supabase, schoolId } = ctx
  if (feeItemIds.length === 0) return { students: [], total: 0 }

  const scope = await resolveGroupEligibility(supabase, schoolId, feeItemIds)
  if (scope.error) return { error: scope.error, students: [], total: 0 }
  const { eligibleClassIds } = scope

  let q = supabase.from('students')
    .select('id, first_name, last_name, admission_number, classes!inner(id, name)', { count: 'exact' })
    .eq('school_id', schoolId).eq('status', 'active')
  if (eligibleClassIds && eligibleClassIds.length > 0) q = q.in('class_id', eligibleClassIds)
  if (params.classId) q = q.eq('class_id', params.classId)
  const search = sanitizeOptInSearch(params.search)
  if (search) q = q.or(optInSearchClause(search))
  q = q.order('last_name').range((params.page - 1) * params.perPage, params.page * params.perPage - 1)

  const { data, count } = await q
  return { students: mapOptInStudentRows(data), total: count || 0 }
}

export async function getEligibleIdsForFeeGroup(feeItemIds: string[], params: EligibleIdsParams): Promise<EligibleIdsResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', ids: [] }
  const { supabase, schoolId } = ctx
  if (feeItemIds.length === 0) return { ids: [] }

  const scope = await resolveGroupEligibility(supabase, schoolId, feeItemIds)
  if (scope.error) return { error: scope.error, ids: [] }
  const { eligibleClassIds } = scope

  let q = supabase.from('students').select('id, class_id').eq('school_id', schoolId).eq('status', 'active')
  if (eligibleClassIds && eligibleClassIds.length > 0) q = q.in('class_id', eligibleClassIds)
  if (params.classId) q = q.eq('class_id', params.classId)
  const search = sanitizeOptInSearch(params.search)
  if (search) q = q.or(optInSearchClause(search))

  const { data } = await q
  return { ids: (data || []).map(s => ({ id: s.id, classId: s.class_id })) }
}

export interface OptInClassOption { id: string; name: string }

// Classes to offer in the opt-ins panel's filter dropdown — a separate lean
// query rather than deriving it from whichever page of students happens to
// be loaded, since with real pagination most classes may never appear on a
// loaded page at all.
export async function getEligibleClassesForFeeItem(feeItemId: string): Promise<{ error?: string; classes: OptInClassOption[] }> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', classes: [] }
  const { supabase, schoolId } = ctx
  const { data: feeItem } = await supabase.from('fee_items').select('id').eq('id', feeItemId).eq('school_id', schoolId).maybeSingle()
  if (!feeItem) return { error: 'Fee item not found', classes: [] }
  const { data } = await supabase.from('classes').select('id, name').eq('school_id', schoolId).eq('is_active', true).order('display_order')
  return { classes: data || [] }
}

export async function getEligibleClassesForFeeGroup(feeItemIds: string[]): Promise<{ error?: string; classes: OptInClassOption[] }> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated', classes: [] }
  const { supabase, schoolId } = ctx
  if (feeItemIds.length === 0) return { classes: [] }
  const scope = await resolveGroupEligibility(supabase, schoolId, feeItemIds)
  if (scope.error) return { error: scope.error, classes: [] }
  let q = supabase.from('classes').select('id, name').eq('school_id', schoolId).eq('is_active', true).order('display_order')
  if (scope.eligibleClassIds && scope.eligibleClassIds.length > 0) q = q.in('id', scope.eligibleClassIds)
  const { data } = await q
  return { classes: data || [] }
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
    .select('id, name, class_id, billing_cycle_id')
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

  let totalAdded = 0
  let totalRemoved = 0

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

    totalAdded += toAdd.length
    totalRemoved += toRemove.length
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.opt_in_bulk_updated',
    targetType: 'fee_group',
    summary: `Updated opt-ins for fee group ${feeItems[0]?.name || 'group'}: ${totalAdded} added, ${totalRemoved} removed across ${feeItems.length} fee item(s)`,
    metadata: { feeItemIds, groupName: feeItems[0]?.name, added: totalAdded, removed: totalRemoved },
  })

  revalidatePath('/fees/structure')
  return { success: true }
}