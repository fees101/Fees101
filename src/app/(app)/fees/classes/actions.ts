'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getSchoolId() {
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
  return schoolId
}

export async function addClass(formData: {
  name: string
  sectionId: string
  displayOrder: number
}) {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return { error: 'Not authenticated' }

  // Check name uniqueness within school
  const { data: existing } = await supabase
    .from('classes')
    .select('id')
    .eq('school_id', schoolId)
    .ilike('name', formData.name.trim())
    .maybeSingle()

  if (existing) {
    return { error: `A class named "${formData.name}" already exists` }
  }

  const { error } = await supabase
    .from('classes')
    .insert({
      school_id: schoolId,
      section_id: formData.sectionId,
      name: formData.name.trim(),
      display_order: formData.displayOrder,
      is_active: true,
    })

  if (error) return { error: error.message }

  revalidatePath('/fees/classes')
  revalidatePath('/fees')
  
  return { success: true }
}

export async function updateClass(classId: string, formData: {
  name: string
  sectionId: string
  displayOrder: number
  isActive: boolean
}) {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return { error: 'Not authenticated' }

  // Check name uniqueness (excluding current class)
  const { data: existing } = await supabase
    .from('classes')
    .select('id')
    .eq('school_id', schoolId)
    .ilike('name', formData.name.trim())
    .neq('id', classId)
    .maybeSingle()

  if (existing) {
    return { error: `A class named "${formData.name}" already exists` }
  }

  const { error } = await supabase
    .from('classes')
    .update({
      name: formData.name.trim(),
      section_id: formData.sectionId,
      display_order: formData.displayOrder,
      is_active: formData.isActive,
    })
    .eq('id', classId)

  if (error) return { error: error.message }

  revalidatePath('/fees/classes')
  revalidatePath('/fees')
  
  return { success: true }
}

export async function toggleClassActive(classId: string, isActive: boolean) {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return { error: 'Not authenticated' }

  // If deactivating, check if there are active students in this class
  if (!isActive) {
    const { count } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('status', 'active')

    if (count && count > 0) {
      return { 
        error: `Cannot deactivate this class — it has ${count} active ${count === 1 ? 'student' : 'students'}. Move them to another class first.` 
      }
    }
  }

  const { error } = await supabase
    .from('classes')
    .update({ is_active: isActive })
    .eq('id', classId)

  if (error) return { error: error.message }

  revalidatePath('/fees/classes')
  revalidatePath('/fees')
  
  return { success: true }
}
export async function addSection(name: string) {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return { error: 'Not authenticated' }

  if (!name.trim()) {
    return { error: 'Section name is required' }
  }

  // Check for duplicate
  const { data: existing } = await supabase
    .from('sections')
    .select('id')
    .eq('school_id', schoolId)
    .ilike('name', name.trim())
    .maybeSingle()

  if (existing) {
    return { error: `A section named "${name}" already exists` }
  }

  // Get next display_order
  const { data: lastSection } = await supabase
    .from('sections')
    .select('display_order')
    .eq('school_id', schoolId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrder = (lastSection?.display_order || 0) + 1

  const { data: newSection, error } = await supabase
    .from('sections')
    .insert({
      school_id: schoolId,
      name: name.trim(),
      display_order: nextOrder,
    })
    .select('id, name')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/fees/classes')

  return { success: true, section: newSection }
}

export async function deleteSection(sectionId: string) {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return { error: 'Not authenticated' }

  // Check if any classes use this section
  const { count } = await supabase
    .from('classes')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', sectionId)

  if (count && count > 0) {
    return { 
      error: `Cannot delete this section — it has ${count} ${count === 1 ? 'class' : 'classes'}. Move them to another section first.` 
    }
  }

  const { error } = await supabase
    .from('sections')
    .delete()
    .eq('id', sectionId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/classes')
  
  return { success: true }
}