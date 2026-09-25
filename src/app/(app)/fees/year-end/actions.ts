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

  // Enrich each student with the balance still owed on the term being rolled
  // from, so the pre-run ledger can state — before anything is committed — how
  // much money carries into the new session versus how much sits on a leaver
  // and carries nowhere. Read-only; mirrors previewCloseTerm's outstanding math
  // (total_amount minus paid_amount on the active term's invoice).
  const { data: activeInvoices } = await supabase
    .from('invoices')
    .select('student_id, total_amount, paid_amount')
    .eq('billing_cycle_id', activeCycle.id)
    .eq('school_id', schoolId)

  const outstandingByStudent: Record<string, number> = {}
  for (const inv of activeInvoices || []) {
    const outstanding = Number(inv.total_amount) - Number(inv.paid_amount || 0)
    if (outstanding > 0) {
      outstandingByStudent[inv.student_id] = (outstandingByStudent[inv.student_id] || 0) + outstanding
    }
  }
  for (const group of groups) {
    for (const row of group.students) {
      row.outstandingAmount = outstandingByStudent[row.studentId] || 0
    }
  }

  return { success: true, groups }
}

export type YearEndFeeCopyPreview = {
  feeItemCount: number
  classCount: number
  fromTermName: string
  fromSessionName: string | null
}

// Read-only preview of the fee structure that createTerm's roll-forward will
// copy into the new session's first term. Mirrors createTerm exactly: every
// per_term fee on the term being rolled from, plus each once_a_session fee
// across the whole outgoing session (deduped by name + class + optional),
// because a once_a_session fee lives only on its session's first term and must
// re-appear on the new year's first term. Prices are copied unchanged. Also
// returns the outgoing term/session names so the surface can title itself
// "roll <this year> into the new year".
export async function getYearEndFeeCopyPreviewAction(): Promise<
  { success: true; preview: YearEndFeeCopyPreview } | { error: string }
> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: activeCycle } = await supabase
    .from('billing_cycles')
    .select('id, name, session_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .maybeSingle()
  if (!activeCycle) return { error: 'No active term to roll over from' }

  let fromSessionName: string | null = null
  if (activeCycle.session_id) {
    const { data: session } = await supabase
      .from('sessions')
      .select('name')
      .eq('id', activeCycle.session_id)
      .maybeSingle()
    fromSessionName = session?.name ?? null
  }

  const feeSelect = 'class_id, name, is_optional_extra'

  const { data: perTermFees } = await supabase
    .from('fee_items')
    .select(feeSelect)
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', activeCycle.id)
    .eq('billing_frequency', 'per_term')

  const sourceFees: { class_id: string | null; name: string; is_optional_extra: boolean }[] = [
    ...(perTermFees || []),
  ]

  if (activeCycle.session_id) {
    const { data: sessionCycles } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('school_id', schoolId)
      .eq('session_id', activeCycle.session_id)
    const sessionCycleIds = (sessionCycles || []).map((c: { id: string }) => c.id)
    if (sessionCycleIds.length > 0) {
      const { data: onceFees } = await supabase
        .from('fee_items')
        .select(feeSelect)
        .eq('school_id', schoolId)
        .eq('billing_frequency', 'once_a_session')
        .in('billing_cycle_id', sessionCycleIds)
      const seen = new Set<string>()
      for (const f of onceFees || []) {
        const key = `${f.name}::${f.class_id ?? 'null'}::${f.is_optional_extra}`
        if (seen.has(key)) continue
        seen.add(key)
        sourceFees.push(f)
      }
    }
  }

  const classIds = new Set<string>()
  for (const f of sourceFees) {
    // A class-agnostic fee (null class_id) applies to every class, so it does
    // not narrow the class count; only class-scoped fees do.
    if (f.class_id) classIds.add(f.class_id)
  }

  return {
    success: true,
    preview: {
      feeItemCount: sourceFees.length,
      classCount: classIds.size,
      fromTermName: activeCycle.name,
      fromSessionName,
    },
  }
}

export type YearEndReadiness = {
  currentSessionName: string | null
  fromTermName: string
  // Every term in the session being rolled from, so the readiness step can flag
  // a term still left in draft (allowed, soft) and a term with no end date set.
  terms: { id: string; name: string; status: string; endDate: string | null }[]
  // Discount requests still awaiting a decision. Approving/declining them before
  // the run keeps carried balances accurate, so this is surfaced as a
  // needs-a-human check (not a hard block).
  pendingDiscountCount: number
  provider: { connected: boolean; name: string | null; mode: string | null }
}

// Read-only. Gathers the few facts the readiness step needs that aren't already
// derivable on the client from the promotion preview (which carries per-student
// balances) or the fee-copy preview. Same tables the rest of Fees reads; no
// mutation. Returns an error only when there is no active term to roll from —
// the same precondition getPromotionPreviewAction enforces, so the surface is
// already gated before this matters.
export async function getYearEndReadinessAction(): Promise<
  { success: true; readiness: YearEndReadiness } | { error: string }
> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: activeCycle } = await supabase
    .from('billing_cycles')
    .select('id, name, session_id')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .maybeSingle()
  if (!activeCycle) return { error: 'No active term to roll over from' }

  let currentSessionName: string | null = null
  let terms: { id: string; name: string; status: string; endDate: string | null }[] = []
  if (activeCycle.session_id) {
    const { data: session } = await supabase
      .from('sessions')
      .select('name')
      .eq('id', activeCycle.session_id)
      .maybeSingle()
    currentSessionName = session?.name ?? null

    const { data: cycles } = await supabase
      .from('billing_cycles')
      .select('id, name, status, end_date')
      .eq('school_id', schoolId)
      .eq('session_id', activeCycle.session_id)
      .order('start_date', { ascending: true })
    terms = (cycles || []).map((c: { id: string; name: string; status: string; end_date: string | null }) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      endDate: c.end_date,
    }))
  } else {
    // Session-less legacy term: it is the only term we can describe.
    terms = [{ id: activeCycle.id, name: activeCycle.name, status: 'active', endDate: null }]
  }

  const { count: pendingDiscountCount } = await supabase
    .from('discounts')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'pending')

  const { data: school } = await supabase
    .from('schools')
    .select('payment_provider, payment_mode')
    .eq('id', schoolId)
    .maybeSingle()

  return {
    success: true,
    readiness: {
      currentSessionName,
      fromTermName: activeCycle.name,
      terms,
      pendingDiscountCount: pendingDiscountCount ?? 0,
      provider: {
        connected: !!school?.payment_provider,
        name: school?.payment_provider ?? null,
        mode: school?.payment_mode ?? null,
      },
    },
  }
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
