'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { getPromotionPreview, PromotionPreviewGroup } from '@/lib/yearEnd/promotion'

async function getContext() {
  // Gated on the 'run-year-end' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('run-year-end')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId }
}

export async function getPromotionPreviewAction(): Promise<
  { success: true; groups: PromotionPreviewGroup[] } | { error: string }
> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: activeCycle } = await supabase
    .from('billing_cycles')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .maybeSingle()
  if (!activeCycle) return { error: 'No active term to roll over from' }

  const groups = await getPromotionPreview(supabase, schoolId)
  return { success: true, groups }
}

export async function getClassesForOverrideAction(): Promise<
  { success: true; classes: { id: string; name: string }[] } | { error: string }
> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: classes } = await supabase
    .from('classes')
    .select('id, name')
    .eq('school_id', schoolId)
    .order('display_order', { ascending: true })

  return { success: true, classes: classes || [] }
}

export type DraftSession = {
  id: string
  name: string
  terms: { id: string; name: string }[]
}

export async function getDraftSessionsAction(): Promise<
  { success: true; sessions: DraftSession[] } | { error: string }
> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: currentActive } = await supabase
    .from('sessions')
    .select('start_date')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .maybeSingle()

  const { data: allDraftSessions } = await supabase
    .from('sessions')
    .select('id, name, start_date')
    .eq('school_id', schoolId)
    .eq('status', 'draft')
    .order('start_date', { ascending: true })

  // Never offer a draft session that predates the currently active one for
  // adoption — it's a leftover from a past/abandoned attempt, not a
  // legitimately prepared-ahead next year, and rolling into it would
  // reopen a stale academic year.
  const sessions = (allDraftSessions || []).filter(
    s => !currentActive || s.start_date >= currentActive.start_date
  )

  if (sessions.length === 0) return { success: true, sessions: [] }

  const { data: cycles } = await supabase
    .from('billing_cycles')
    .select('id, name, session_id')
    .eq('school_id', schoolId)
    .in('session_id', sessions.map(s => s.id))
    .order('start_date', { ascending: true })

  return {
    success: true,
    sessions: sessions.map(s => ({
      id: s.id,
      name: s.name,
      terms: (cycles || []).filter(c => c.session_id === s.id).map(c => ({ id: c.id, name: c.name })),
    })),
  }
}
