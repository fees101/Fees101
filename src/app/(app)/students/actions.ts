'use server'

import { revalidatePath } from 'next/cache'
import { tryAutoCreateStudentDVA } from '@/lib/payments/provisionDVA'
import { requirePermission } from '@/lib/auth/permissions'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { normalizePhone } from '@/lib/messaging/sendMessage'

interface AddStudentInput {
  firstName: string
  lastName: string
  admissionNumber: string
  classId: string
  admissionDate: string
  primaryParentName: string
  primaryParentPhone: string
  primaryParentEmail?: string
  secondaryParentName?: string
  secondaryParentPhone?: string
  secondaryParentEmail?: string
  // Set once staff have confirmed a name-mismatched phone match is genuinely
  // the same family (see the needsConfirmation branch below).
  confirmFamilyLink?: boolean
}

export async function addStudent(input: AddStudentInput) {
  // Gated on manage-students (owner/super_admin/is_admin bypass).
  const authCtx = await requirePermission('manage-students')
  if (!authCtx || !authCtx.schoolId) return { error: 'Not authorized' }
  const { supabase, schoolId, userId } = authCtx

  // Get the section (using first section for now)
  const { data: section } = await supabase
    .from('sections')
    .select('id')
    .eq('school_id', schoolId)
    .limit(1)
    .single()

  if (!section) return { error: 'No section found' }

  // Check if admission number is unique within school
  const { data: existing } = await supabase
    .from('students')
    .select('id')
    .eq('school_id', schoolId)
    .eq('admission_number', input.admissionNumber)
    .maybeSingle()

  if (existing) {
    return { error: `Admission number ${input.admissionNumber} already exists` }
  }

  // Check if a family with the same primary parent phone exists (link instead
  // of duplicate). Normalized so "0803...", "+234 803...", and "234803..."
  // all resolve to the same family instead of silently fragmenting into
  // separate records (2026-09-16 stress test).
  const normalizedPhone = normalizePhone(input.primaryParentPhone)
  const { data: existingFamily } = await supabase
    .from('families')
    .select('id, primary_parent_name')
    .eq('school_id', schoolId)
    .eq('primary_parent_phone', normalizedPhone)
    .maybeSingle()

  let familyId: string

  if (existingFamily) {
    // A phone match with a different parent name is exactly the
    // sibling-discount abuse vector flagged in the stress test — someone
    // (by mistake or on purpose) enters another family's number and
    // silently inherits their discount tier. Require staff to confirm it's
    // genuinely the same family before linking.
    const nameMatches = existingFamily.primary_parent_name.trim().toLowerCase() === input.primaryParentName.trim().toLowerCase()
    if (!nameMatches && !input.confirmFamilyLink) {
      return {
        needsConfirmation: true as const,
        existingFamilyName: existingFamily.primary_parent_name,
      }
    }
    familyId = existingFamily.id
  } else {
    // Create new family
    const { data: newFamily, error: familyError } = await supabase
      .from('families')
      .insert({
        school_id: schoolId,
        primary_parent_name: input.primaryParentName,
        primary_parent_phone: normalizedPhone,
        primary_parent_email: input.primaryParentEmail || null,
        secondary_parent_name: input.secondaryParentName || null,
        secondary_parent_phone: input.secondaryParentPhone ? normalizePhone(input.secondaryParentPhone) : null,
        secondary_parent_email: input.secondaryParentEmail || null,
      })
      .select('id')
      .single()

    if (familyError || !newFamily) {
      return { error: `Failed to create family: ${familyError?.message || 'Unknown error'}` }
    }
    familyId = newFamily.id
  }

  // Create the student
  const { data: newStudent, error: studentError } = await supabase
    .from('students')
    .insert({
      school_id: schoolId,
      section_id: section.id,
      class_id: input.classId,
      family_id: familyId,
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      admission_number: input.admissionNumber,
      admission_date: input.admissionDate,
      status: 'active',
    })
    .select('id')
    .single()

  if (studentError || !newStudent) {
    return { error: `Failed to add student: ${studentError?.message || 'Unknown error'}` }
  }

  // Auto-provision a payment account (no-op if payments aren't configured).
  // Best-effort: never blocks student creation — the Settings → Payments bulk
  // button backfills any that don't get one here.
  await tryAutoCreateStudentDVA(
    supabase,
    schoolId,
    newStudent.id,
    `${input.firstName} ${input.lastName}`.trim()
  )

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'student.added',
    targetType: 'student',
    targetId: newStudent.id,
    summary: `Added student ${`${input.firstName} ${input.lastName}`.trim()}`,
  })

  revalidatePath('/students')
  return { success: true }
}