'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateStudentDetails(studentId: string, formData: {
  firstName: string
  lastName: string
  admissionNumber: string
  classId: string
  admissionDate: string
  status: string
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Get current student to check admission number conflicts
  const { data: currentStudent } = await supabase
    .from('students')
    .select('school_id, admission_number')
    .eq('id', studentId)
    .single()

  if (!currentStudent) return { error: 'Student not found' }

  // If admission number changed, check uniqueness
  if (currentStudent.admission_number !== formData.admissionNumber) {
    const { data: existing } = await supabase
      .from('students')
      .select('id')
      .eq('school_id', currentStudent.school_id)
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
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

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

  if (error) return { error: error.message }

  revalidatePath(`/students/${studentId}`)
  revalidatePath('/students')

  return { success: true }
}

export async function updateFamilyNotes(familyId: string, studentId: string, notes: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('families')
    .update({ notes: notes || null })
    .eq('id', familyId)

  if (error) return { error: error.message }

  revalidatePath(`/students/${studentId}`)

  return { success: true }
}

export async function updateStudentStatus(studentId: string, status: 'withdrawn' | 'graduated') {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('students')
    .update({ status })
    .eq('id', studentId)

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