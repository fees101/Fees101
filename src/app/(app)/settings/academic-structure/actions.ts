'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/permissions'
import { logAuditEvent } from '@/lib/audit/logAudit'

// Academic structure — gate on manage-academic-structure (owner/super_admin/
// is_admin bypass inside requirePermission). Returns supabase + userId
// alongside schoolId so call sites can reuse the same client and log audit
// events without a second permission lookup.
async function getContext() {
  const ctx = await requirePermission('manage-academic-structure')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

function revalidateClassDependents() {
  revalidatePath('/settings/academic-structure')
  revalidatePath('/fees')
  revalidatePath('/fees/structure')
  revalidatePath('/fees/cycles')
  revalidatePath('/students')
}

export async function addClass(formData: {
  name: string
  sectionId: string
  displayOrder: number
  nextClassId?: string | null
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  // Section must belong to this school — otherwise a class could be attached
  // to another school's section.
  const { data: section } = await supabase
    .from('sections')
    .select('id')
    .eq('id', formData.sectionId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!section) return { error: 'Section not found' }

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

  const { data: newClass, error } = await supabase
    .from('classes')
    .insert({
      school_id: schoolId,
      section_id: formData.sectionId,
      name: formData.name.trim(),
      display_order: formData.displayOrder,
      is_active: true,
      next_class_id: formData.nextClassId || null,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'class.added',
    targetType: 'class',
    targetId: newClass?.id,
    summary: `Added class "${formData.name.trim()}"`,
    metadata: { name: formData.name.trim(), sectionId: formData.sectionId, displayOrder: formData.displayOrder },
  })

  revalidateClassDependents()

  return { success: true }
}

export async function updateClass(classId: string, formData: {
  name: string
  sectionId: string
  displayOrder: number
  isActive: boolean
  nextClassId?: string | null
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: current } = await supabase
    .from('classes')
    .select('name, section_id, display_order, is_active, next_class_id')
    .eq('id', classId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!current) return { error: 'Class not found' }

  const { data: section } = await supabase
    .from('sections')
    .select('id')
    .eq('id', formData.sectionId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!section) return { error: 'Section not found' }

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

  if (formData.nextClassId === classId) {
    return { error: 'A class cannot promote into itself' }
  }

  const { error } = await supabase
    .from('classes')
    .update({
      name: formData.name.trim(),
      section_id: formData.sectionId,
      display_order: formData.displayOrder,
      is_active: formData.isActive,
      next_class_id: formData.nextClassId || null,
    })
    .eq('id', classId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'class.updated',
    targetType: 'class',
    targetId: classId,
    summary: `Updated class "${current.name}"`,
    metadata: {
      before: current,
      after: {
        name: formData.name.trim(),
        sectionId: formData.sectionId,
        displayOrder: formData.displayOrder,
        isActive: formData.isActive,
        nextClassId: formData.nextClassId || null,
      },
    },
  })

  revalidateClassDependents()

  return { success: true }
}

export async function toggleClassActive(classId: string, isActive: boolean) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: cls } = await supabase
    .from('classes')
    .select('id, name')
    .eq('id', classId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!cls) return { error: 'Class not found' }

  // If deactivating, check if there are active students in this class
  if (!isActive) {
    const { count } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('school_id', schoolId)
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
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'class.active_toggled',
    targetType: 'class',
    targetId: classId,
    summary: `${isActive ? 'Activated' : 'Deactivated'} class "${cls.name}"`,
    metadata: { name: cls.name, isActive },
  })

  revalidateClassDependents()

  return { success: true }
}
export async function addSection(name: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'section.added',
    targetType: 'section',
    targetId: newSection?.id,
    summary: `Added section "${name.trim()}"`,
    metadata: { name: name.trim(), displayOrder: nextOrder },
  })

  revalidatePath('/settings/academic-structure')

  return { success: true, section: newSection }
}

export async function updateSection(sectionId: string, name: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  if (!name.trim()) {
    return { error: 'Section name is required' }
  }

  const { data: current } = await supabase
    .from('sections')
    .select('name')
    .eq('id', sectionId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!current) return { error: 'Section not found' }

  // Check for duplicate (excluding this section)
  const { data: existing } = await supabase
    .from('sections')
    .select('id')
    .eq('school_id', schoolId)
    .ilike('name', name.trim())
    .neq('id', sectionId)
    .maybeSingle()

  if (existing) {
    return { error: `A section named "${name}" already exists` }
  }

  const { error } = await supabase
    .from('sections')
    .update({ name: name.trim() })
    .eq('id', sectionId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'section.updated',
    targetType: 'section',
    targetId: sectionId,
    summary: `Renamed section "${current.name}" to "${name.trim()}"`,
    metadata: { fromName: current.name, toName: name.trim() },
  })

  revalidatePath('/settings/academic-structure')

  return { success: true }
}

export async function deleteSection(sectionId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: section } = await supabase
    .from('sections')
    .select('name')
    .eq('id', sectionId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!section) return { error: 'Section not found' }

  // Check if any classes use this section
  const { count } = await supabase
    .from('classes')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', sectionId)
    .eq('school_id', schoolId)

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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'section.deleted',
    targetType: 'section',
    targetId: sectionId,
    summary: `Deleted section "${section.name}"`,
    metadata: { name: section.name },
  })

  revalidatePath('/settings/academic-structure')

  return { success: true }
}