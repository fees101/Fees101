import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

export interface FamilyAccountRow {
  id: string
  primaryParentName: string
  primaryParentPhone: string
  dvaEnabled: boolean
  accountNumber: string | null
  bankName: string | null
  childCount: number
}

export type FamilyDvaFilter = 'all' | 'on' | 'off'

export interface FamilyAccountsResult {
  rows: FamilyAccountRow[]
  total: number
  counts: { all: number; on: number; off: number }
}

// Phase 7 (ROADMAP.md, Family-level DVA) — the toggle only ever lived on an
// individual sibling's own student page; this is the first school-wide place
// to see how many families use a shared account. Scoped to families with 2+
// active children only, since a lone child can never have this toggle at all
// (FamilyDvaToggle.tsx is only rendered when a student has siblings) — a
// single-child family showing up here with nothing actionable would just be
// noise. No `families(students(count))` embed: PostgREST returns one row per
// matching child rather than an aggregate count, so the count is computed in
// JS from a plain student list instead of asking Postgres to aggregate it.
export async function getFamilyAccounts(opts: {
  search: string
  filter: FamilyDvaFilter
  page: number
  perPage: number
}): Promise<FamilyAccountsResult | null> {
  const supabase = await createClient()
  const ctx = await getAuthContext()
  const schoolId = ctx?.schoolId ?? null
  if (!schoolId) return null

  const { data: activeStudents } = await supabase
    .from('students')
    .select('family_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .not('family_id', 'is', null)

  const childCounts = new Map<string, number>()
  for (const s of activeStudents || []) {
    const fid = (s as any).family_id as string
    childCounts.set(fid, (childCounts.get(fid) || 0) + 1)
  }
  const eligibleFamilyIds = Array.from(childCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([id]) => id)

  if (eligibleFamilyIds.length === 0) {
    return { rows: [], total: 0, counts: { all: 0, on: 0, off: 0 } }
  }

  let query = supabase
    .from('families')
    .select('id, primary_parent_name, primary_parent_phone, dva_enabled, provider_dva_account_number, provider_dva_bank_name')
    .eq('school_id', schoolId)
    .in('id', eligibleFamilyIds)

  if (opts.search.trim()) {
    const term = opts.search.trim().replace(/[%,]/g, '')
    query = query.or(`primary_parent_name.ilike.%${term}%,primary_parent_phone.ilike.%${term}%`)
  }

  const { data: families } = await query.order('primary_parent_name')
  const all = (families || []).map(f => ({
    id: f.id,
    primaryParentName: f.primary_parent_name || '',
    primaryParentPhone: f.primary_parent_phone || '',
    dvaEnabled: !!f.dva_enabled,
    accountNumber: f.provider_dva_account_number,
    bankName: f.provider_dva_bank_name,
    childCount: childCounts.get(f.id) || 0,
  }))

  const counts = {
    all: all.length,
    on: all.filter(f => f.dvaEnabled).length,
    off: all.filter(f => !f.dvaEnabled).length,
  }

  const filtered = opts.filter === 'all' ? all : all.filter(f => (opts.filter === 'on' ? f.dvaEnabled : !f.dvaEnabled))
  const start = (opts.page - 1) * opts.perPage
  const rows = filtered.slice(start, start + opts.perPage)

  return { rows, total: filtered.length, counts }
}
