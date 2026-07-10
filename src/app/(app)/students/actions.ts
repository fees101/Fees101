'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { tryAutoCreateStudentDVA } from '@/lib/payments/provisionDVA'

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
}

export async function addStudent(input: AddStudentInput) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

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
  if (!schoolId) return { error: 'No school context' }

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

  // Check if a family with the same primary parent phone exists (link instead of duplicate)
  const { data: existingFamily } = await supabase
    .from('families')
    .select('id')
    .eq('school_id', schoolId)
    .eq('primary_parent_phone', input.primaryParentPhone)
    .maybeSingle()

  let familyId: string

  if (existingFamily) {
    familyId = existingFamily.id
  } else {
    // Create new family
    const { data: newFamily, error: familyError } = await supabase
      .from('families')
      .insert({
        school_id: schoolId,
        primary_parent_name: input.primaryParentName,
        primary_parent_phone: input.primaryParentPhone,
        primary_parent_email: input.primaryParentEmail || null,
        secondary_parent_name: input.secondaryParentName || null,
        secondary_parent_phone: input.secondaryParentPhone || null,
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
      first_name: input.firstName,
      last_name: input.lastName,
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

  revalidatePath('/students')
  return { success: true }
}