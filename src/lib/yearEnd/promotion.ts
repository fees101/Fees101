export interface PromotionPreviewRow {
  studentId: string
  studentName: string
  admissionNumber: string
  currentClassId: string
  currentClassName: string
  suggestedAction: 'promote' | 'graduate'
  suggestedTargetClassId: string | null
  suggestedTargetClassName: string | null
}

export interface PromotionPreviewGroup {
  classId: string
  className: string
  students: PromotionPreviewRow[]
}

// Resolves, for every active student, where their class's next_class_id
// points — a null next_class_id is an explicit exit point (graduation).
// This is only a suggestion: the wizard lets a bursar override any student
// to repeat, graduate, or move to a different class before committing.
export async function getPromotionPreview(supabase: any, schoolId: string): Promise<PromotionPreviewGroup[]> {
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, next_class_id, display_order')
    .eq('school_id', schoolId)
    .order('display_order', { ascending: true })

  const classById: Record<string, { id: string; name: string; next_class_id: string | null }> = {}
  ;(classes || []).forEach((c: any) => { classById[c.id] = c })

  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name, admission_number, class_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')

  const groups: Record<string, PromotionPreviewGroup> = {}

  for (const student of students || []) {
    const currentClass = classById[student.class_id]
    if (!currentClass) continue

    const targetClass = currentClass.next_class_id ? classById[currentClass.next_class_id] : null

    const row: PromotionPreviewRow = {
      studentId: student.id,
      studentName: `${student.first_name} ${student.last_name}`,
      admissionNumber: student.admission_number,
      currentClassId: currentClass.id,
      currentClassName: currentClass.name,
      suggestedAction: targetClass ? 'promote' : 'graduate',
      suggestedTargetClassId: targetClass?.id || null,
      suggestedTargetClassName: targetClass?.name || null,
    }

    if (!groups[currentClass.id]) {
      groups[currentClass.id] = { classId: currentClass.id, className: currentClass.name, students: [] }
    }
    groups[currentClass.id].students.push(row)
  }

  return Object.values(groups).sort((a, b) => a.className.localeCompare(b.className))
}

export interface PromotionDecision {
  studentId: string
  action: 'promote' | 'repeat' | 'graduate'
  targetClassId?: string
}

export async function bulkPromoteStudents(
  supabase: any,
  schoolId: string,
  decisions: PromotionDecision[]
): Promise<{ promoted: number; graduated: number }> {
  let promoted = 0
  let graduated = 0

  for (const decision of decisions) {
    if (decision.action === 'graduate') {
      const { error } = await supabase
        .from('students')
        .update({ status: 'graduated', graduated_at: new Date().toISOString() })
        .eq('id', decision.studentId)
        .eq('school_id', schoolId)
      if (!error) graduated++
      continue
    }

    if (!decision.targetClassId) continue
    const { error } = await supabase
      .from('students')
      .update({ class_id: decision.targetClassId })
      .eq('id', decision.studentId)
      .eq('school_id', schoolId)
    if (!error) promoted++
  }

  return { promoted, graduated }
}
