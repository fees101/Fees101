import { createClient } from '@/lib/supabase/server'

// Resolve the caller's school, matching the pattern used across the other
// query modules (super_admin with no school_id falls back to the first school).
async function resolveSchoolId(supabase: any): Promise<string | null> {
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
  return schoolId || null
}

export interface FeeRevenueRow {
  name: string
  kind: 'required' | 'opt_in'
  studentsBilled: number
  billed: number
  collected: number
  outstanding: number
  rate: number
}

export interface ClassRevenueRow {
  className: string
  studentsBilled: number
  billed: number
  collected: number
  outstanding: number
  rate: number
}

export interface PaymentsAnalytics {
  cycles: { id: string; name: string; status: string }[]
  selectedCycle: { id: string; name: string } | null
  summary: {
    billed: number
    collected: number
    outstanding: number
    creditApplied: number
    discountTotal: number
    invoiceCount: number
    collectionRate: number
  }
  byFee: FeeRevenueRow[]
  byClass: ClassRevenueRow[]
}

const EMPTY: PaymentsAnalytics = {
  cycles: [],
  selectedCycle: null,
  summary: { billed: 0, collected: 0, outstanding: 0, creditApplied: 0, discountTotal: 0, invoiceCount: 0, collectionRate: 0 },
  byFee: [],
  byClass: [],
}

// Everything on this page is deliberately INVOICE-ALLOCATION based (not the
// date-of-payment "collected" used on the dashboard) so every figure — the
// summary tiles, the by-fee table, the by-class table — reconciles exactly
// with each other. "Collected" here means "of what was billed, how much has
// been paid down", and per-fee/per-class collected is allocated by how far
// each invoice is settled (money is fungible across an invoice's lines, so a
// per-line figure can only ever be a proportional estimate — labelled as such
// in the UI).
export async function getPaymentsAnalytics(cycleId?: string): Promise<PaymentsAnalytics> {
  const supabase = await createClient()
  const schoolId = await resolveSchoolId(supabase)
  if (!schoolId) return EMPTY

  const { data: cycles } = await supabase
    .from('billing_cycles')
    .select('id, name, status, start_date')
    .eq('school_id', schoolId)
    .order('start_date', { ascending: false })

  if (!cycles || cycles.length === 0) return EMPTY

  // Default to the active cycle, else the most recent one.
  const selected = (cycleId && cycles.find((c: any) => c.id === cycleId))
    || cycles.find((c: any) => c.status === 'active')
    || cycles[0]

  const { data: invoices } = await supabase
    .from('invoices')
    .select('total_amount, paid_amount, outstanding_amount, credit_applied, discount_amount, status, line_items, students(class_id, classes(name))')
    .eq('school_id', schoolId)
    .eq('billing_cycle_id', selected.id)
    .neq('status', 'cancelled')

  const rows = invoices || []

  // ---- Term summary ----
  // Billed (gross) = net total + whatever credit covered part of it, same
  // definition the dashboard/fees overview use so the number is familiar.
  let billed = 0, collected = 0, outstanding = 0, creditApplied = 0, discountTotal = 0
  for (const inv of rows) {
    const total = Number(inv.total_amount) || 0
    const paid = Number(inv.paid_amount) || 0
    const credit = Number(inv.credit_applied) || 0
    billed += total + credit
    collected += paid + credit
    outstanding += Number(inv.outstanding_amount ?? (total - paid)) || 0
    creditApplied += credit
    discountTotal += Number(inv.discount_amount) || 0
  }
  const collectionRate = billed > 0 ? Math.round((collected / billed) * 100) : 0

  // Per-invoice settlement ratio, used to allocate collected money across the
  // fee lines and classes. total_amount is net of credit, so an invoice fully
  // covered by credit (paid_amount 0, outstanding 0) still counts as settled.
  function settledRatio(inv: any): number {
    const total = Number(inv.total_amount) || 0
    const paid = Number(inv.paid_amount) || 0
    const out = Number(inv.outstanding_amount ?? (total - paid)) || 0
    if (out <= 0) return 1
    if (total <= 0) return 0
    return Math.max(0, Math.min(1, paid / total))
  }

  // ---- Revenue by fee / opt-in ----
  // Aggregate each invoice's current-term fee lines (required + opt_in only —
  // previous_balance and credit_applied lines aren't fees) grouped by name.
  const feeMap = new Map<string, FeeRevenueRow>()
  for (const inv of rows) {
    const ratio = settledRatio(inv)
    const lines = Array.isArray(inv.line_items) ? inv.line_items : []
    for (const li of lines) {
      if (li.kind !== 'required' && li.kind !== 'opt_in') continue
      const amount = Number(li.amount) || 0
      if (amount <= 0) continue
      const key = `${li.kind}::${li.name}`
      const existing = feeMap.get(key) || {
        name: li.name, kind: li.kind, studentsBilled: 0, billed: 0, collected: 0, outstanding: 0, rate: 0,
      }
      existing.studentsBilled += 1
      existing.billed += amount
      existing.collected += amount * ratio
      feeMap.set(key, existing)
    }
  }
  const byFee = Array.from(feeMap.values()).map(r => {
    r.collected = Math.round(r.collected)
    r.outstanding = Math.max(0, r.billed - r.collected)
    r.rate = r.billed > 0 ? Math.round((r.collected / r.billed) * 100) : 0
    return r
  }).sort((a, b) => b.billed - a.billed)

  // ---- Revenue by class ----
  const classMap = new Map<string, ClassRevenueRow>()
  for (const inv of rows) {
    const student: any = inv.students
    const className = student?.classes?.name || 'Unassigned'
    const total = Number(inv.total_amount) || 0
    const credit = Number(inv.credit_applied) || 0
    const paid = Number(inv.paid_amount) || 0
    const out = Number(inv.outstanding_amount ?? (total - paid)) || 0
    const existing = classMap.get(className) || {
      className, studentsBilled: 0, billed: 0, collected: 0, outstanding: 0, rate: 0,
    }
    existing.studentsBilled += 1
    existing.billed += total + credit
    existing.collected += paid + credit
    existing.outstanding += out
    classMap.set(className, existing)
  }
  const byClass = Array.from(classMap.values()).map(r => {
    r.rate = r.billed > 0 ? Math.round((r.collected / r.billed) * 100) : 0
    return r
  }).sort((a, b) => b.billed - a.billed)

  return {
    cycles: cycles.map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
    selectedCycle: { id: selected.id, name: selected.name },
    summary: { billed, collected, outstanding, creditApplied, discountTotal, invoiceCount: rows.length, collectionRate },
    byFee,
    byClass,
  }
}
