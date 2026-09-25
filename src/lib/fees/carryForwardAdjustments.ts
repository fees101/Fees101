// Carries a student's opt-in/exemption fee adjustments from one term to the
// next. Adjustments are stored against a specific fee_item_id, so a new term
// (which has brand-new fee_item rows, even for "the same" fee) loses them
// unless re-matched by name against the student's *current* class.
export async function carryForwardFeeAdjustments(
  supabase: any,
  schoolId: string,
  sourceCycleId: string,
  targetCycleId: string,
  // True when the target term opens a new academic year. A once_a_session
  // opt-in follows its fee only across that boundary — within the same session
  // the fee isn't on the sibling term, so carrying the opt-in would just leave
  // an unmatchable row. Defaults true so any caller that hasn't opted in keeps
  // the safe "carry it" behaviour.
  crossingSession: boolean = true
): Promise<{ carried: number; unmatched: { studentId: string; feeItemName: string }[] }> {
  const { data: sourceAdjustments } = await supabase
    .from('student_fee_adjustments')
    .select('student_id, adjustment_type, carry_forward, fee_items!inner(name, billing_cycle_id, is_recurring, billing_frequency)')
    .eq('school_id', schoolId)
    .eq('fee_items.billing_cycle_id', sourceCycleId)

  if (!sourceAdjustments || sourceAdjustments.length === 0) {
    return { carried: 0, unmatched: [] }
  }

  const studentIds = Array.from(new Set(sourceAdjustments.map((a: any) => a.student_id)))

  const [{ data: targetFeeItems }, { data: students }] = await Promise.all([
    supabase
      .from('fee_items')
      .select('id, name, class_id')
      .eq('school_id', schoolId)
      .eq('billing_cycle_id', targetCycleId),
    supabase
      .from('students')
      .select('id, class_id')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .in('id', studentIds),
  ])

  const classIdByStudentId: Record<string, string> = {}
  ;(students || []).forEach((s: any) => { classIdByStudentId[s.id] = s.class_id })

  // Only active students get their adjustments carried. A student who was
  // graduated or withdrawn at rollover won't be invoiced on the new term, so
  // carrying their opt-in/exemption just leaves a phantom row that could
  // resurface (wrongly) if they're ever re-admitted.
  const activeStudentIds = new Set((students || []).map((s: any) => s.id))

  // Fee items are matched case-insensitively, and only against an item that's
  // either class-agnostic or belongs to the student's *current* class — a
  // same-named item scoped to a different class is not the same fee.
  function findTargetFeeItem(studentId: string, feeItemName: string) {
    const studentClassId = classIdByStudentId[studentId]
    const normalizedName = feeItemName.trim().toLowerCase()
    return (targetFeeItems || []).find((f: any) =>
      f.name.trim().toLowerCase() === normalizedName &&
      (f.class_id === null || f.class_id === studentClassId)
    )
  }

  const rowsToInsert: { school_id: string; student_id: string; fee_item_id: string; adjustment_type: string }[] = []
  const unmatched: { studentId: string; feeItemName: string }[] = []

  for (const adj of sourceAdjustments) {
    if (!activeStudentIds.has(adj.student_id)) continue
    // A one-time opt-in (e.g. a uniform purchase) is only meant to bill once —
    // it should not resurface on the new term just because the student never
    // explicitly opted out. Exemptions (on mandatory fees) are unaffected;
    // frequency only has meaning for optional fees here.
    const freq: string = adj.fee_items?.billing_frequency
      || (adj.fee_items?.is_recurring === false ? 'this_term_only' : 'per_term')
    if (adj.adjustment_type === 'opt_in' && freq === 'this_term_only') continue
    // A once_a_session opt-in only follows its fee when we cross into a new
    // year. On a sibling term in the same session the fee row doesn't exist, so
    // carrying the opt-in would just be noise (an unmatched row).
    if (adj.adjustment_type === 'opt_in' && freq === 'once_a_session' && !crossingSession) continue
    // A student opted out of a fee they'd already paid for this term keeps
    // their opt-in row in place (the paid invoice stays untouched) but is
    // flagged not to carry forward — the deferred opt-out takes effect here.
    if (adj.carry_forward === false) continue
    const feeItemName = adj.fee_items?.name
    const targetItem = feeItemName ? findTargetFeeItem(adj.student_id, feeItemName) : null
    if (!targetItem) {
      unmatched.push({ studentId: adj.student_id, feeItemName: feeItemName || '(unknown fee)' })
      continue
    }
    rowsToInsert.push({
      school_id: schoolId,
      student_id: adj.student_id,
      fee_item_id: targetItem.id,
      adjustment_type: adj.adjustment_type,
    })
  }

  let carried = 0
  if (rowsToInsert.length > 0) {
    const { data: inserted } = await supabase
      .from('student_fee_adjustments')
      .upsert(rowsToInsert, { onConflict: 'student_id,fee_item_id', ignoreDuplicates: true })
      .select('id')
    carried = inserted?.length || 0
  }

  return { carried, unmatched }
}
