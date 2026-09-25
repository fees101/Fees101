// Keeps a student's opt-in/exemption choice from going stale when a future
// term already exists (created ahead of time, or via carry-forward) before
// the choice is made. Mirrors carryForwardAdjustments.ts's name+class match
// and billing-frequency skip rules, but runs at edit time rather than
// term-creation time, and only ever fills terms that don't already have
// their own explicit adjustment — it never overwrites a choice an admin made
// directly on that term. Rows it does fill are flagged auto_propagated so a
// later removal of the source can retract them without touching anything an
// admin set themselves.

interface FeeItemRow {
  id: string
  name: string
  class_id: string | null
  billing_frequency: string | null
  is_recurring: boolean | null
}

async function getFutureCycles(supabase: any, schoolId: string, sourceCycleId: string) {
  const { data: sourceCycle } = await supabase
    .from('billing_cycles')
    .select('id, start_date, session_id')
    .eq('id', sourceCycleId)
    .eq('school_id', schoolId)
    .single()
  if (!sourceCycle) return { sourceCycle: null, futureCycles: [] as any[] }

  const { data: futureCycles } = await supabase
    .from('billing_cycles')
    .select('id, start_date, session_id')
    .eq('school_id', schoolId)
    .in('status', ['draft', 'active'])
    .gt('start_date', sourceCycle.start_date)
    .order('start_date', { ascending: true })

  return { sourceCycle, futureCycles: futureCycles || [] }
}

function findTargetFeeItem(feeItems: FeeItemRow[], feeItemName: string, studentClassId: string | null) {
  const normalizedName = feeItemName.trim().toLowerCase()
  return feeItems.find(f =>
    f.name.trim().toLowerCase() === normalizedName &&
    (f.class_id === null || f.class_id === studentClassId)
  )
}

function isSkippedByFrequency(adjustmentType: string, feeItem: FeeItemRow, crossingSession: boolean) {
  const freq = feeItem.billing_frequency || (feeItem.is_recurring === false ? 'this_term_only' : 'per_term')
  if (adjustmentType === 'opt_in' && freq === 'this_term_only') return true
  if (adjustmentType === 'opt_in' && freq === 'once_a_session' && !crossingSession) return true
  return false
}

// Called right after an admin sets an opt-in or exemption. Fills the same
// choice forward into every future, not-yet-closed term's matching fee item
// that has no adjustment of its own yet.
export async function propagateAdjustmentForward(
  supabase: any,
  schoolId: string,
  studentId: string,
  sourceCycleId: string,
  feeItemName: string,
  adjustmentType: 'opt_in' | 'exempt',
  createdBy: string | null
): Promise<{ propagated: number }> {
  const { sourceCycle, futureCycles } = await getFutureCycles(supabase, schoolId, sourceCycleId)
  if (!sourceCycle || futureCycles.length === 0) return { propagated: 0 }

  const { data: student } = await supabase
    .from('students')
    .select('class_id')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()
  const studentClassId = student?.class_id ?? null

  let propagated = 0

  for (const cycle of futureCycles) {
    const crossingSession = cycle.session_id !== sourceCycle.session_id

    const { data: feeItems } = await supabase
      .from('fee_items')
      .select('id, name, class_id, billing_frequency, is_recurring')
      .eq('school_id', schoolId)
      .eq('billing_cycle_id', cycle.id)

    const targetItem = findTargetFeeItem(feeItems || [], feeItemName, studentClassId)
    if (!targetItem) continue
    if (isSkippedByFrequency(adjustmentType, targetItem, crossingSession)) continue

    const { data: existing } = await supabase
      .from('student_fee_adjustments')
      .select('id')
      .eq('student_id', studentId)
      .eq('fee_item_id', targetItem.id)
      .eq('school_id', schoolId)
      .maybeSingle()
    if (existing) continue

    const { error } = await supabase
      .from('student_fee_adjustments')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        fee_item_id: targetItem.id,
        adjustment_type: adjustmentType,
        created_by: createdBy,
        auto_propagated: true,
      })
    if (!error) propagated++
  }

  return { propagated }
}

// Called right after an admin removes an opt-in or exemption outright (not
// the deferred-to-next-term paid-invoice case, which re-inserts rather than
// removing). Retracts the same choice from future terms, but only rows this
// feature itself filled in — never a row an admin set directly.
export async function retractPropagatedAdjustment(
  supabase: any,
  schoolId: string,
  studentId: string,
  sourceCycleId: string,
  feeItemName: string,
  adjustmentType: 'opt_in' | 'exempt'
): Promise<{ retracted: number }> {
  const { sourceCycle, futureCycles } = await getFutureCycles(supabase, schoolId, sourceCycleId)
  if (!sourceCycle || futureCycles.length === 0) return { retracted: 0 }

  const { data: student } = await supabase
    .from('students')
    .select('class_id')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single()
  const studentClassId = student?.class_id ?? null

  let retracted = 0

  for (const cycle of futureCycles) {
    const { data: feeItems } = await supabase
      .from('fee_items')
      .select('id, name, class_id, billing_frequency, is_recurring')
      .eq('school_id', schoolId)
      .eq('billing_cycle_id', cycle.id)

    const targetItem = findTargetFeeItem(feeItems || [], feeItemName, studentClassId)
    if (!targetItem) continue

    const { data: deleted } = await supabase
      .from('student_fee_adjustments')
      .delete()
      .eq('student_id', studentId)
      .eq('fee_item_id', targetItem.id)
      .eq('school_id', schoolId)
      .eq('adjustment_type', adjustmentType)
      .eq('auto_propagated', true)
      .select('id')
    retracted += deleted?.length || 0
  }

  return { retracted }
}
