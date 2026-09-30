'use server'

import { createClient } from '@/lib/supabase/server'
import { getAuthContext, can } from '@/lib/auth/permissions'

export interface FamilyChildRow {
  id: string
  firstName: string
  lastName: string
  className: string
}

type GetFamilyChildrenResult = { children: FamilyChildRow[] } | { error: string }

// Backs the Family accounts drawer (FamilyAccountDrawer.tsx) — fetched on
// demand per family when the drawer opens, rather than joined into the list
// query, since the roster itself only needs a count for the table rows.
export async function getFamilyChildren(familyId: string): Promise<GetFamilyChildrenResult> {
  const ctx = await getAuthContext()
  if (!ctx || !can(ctx, 'manage-students')) return { error: 'Not authorized' }
  if (!ctx.schoolId) return { error: 'No school on this account' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('students')
    .select('id, first_name, last_name, classes(name)')
    .eq('school_id', ctx.schoolId)
    .eq('family_id', familyId)
    .eq('status', 'active')
    .order('first_name')

  if (error) return { error: error.message }

  return {
    children: (data || []).map((s: any) => ({
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      className: s.classes?.name || '',
    })),
  }
}
