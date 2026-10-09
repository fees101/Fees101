import type {
  TermPoint, FeeCyclePoint, DiscountCyclePoint, ClassCyclePoint, FeeClassPoint, RefundCyclePoint,
} from '@/lib/queries/analytics'

// Pure aggregation over a chosen set of cycles. The dashboard picks the cycle
// set (a brushed range, a preset, or a comparison pick) and calls these — no
// DB round-trip. Shared shapes the chart components consume.

export interface Summary {
  billed: number
  collected: number
  outstanding: number
  discountTotal: number
  grossPotential: number
  invoiceCount: number
  collectionRate: number
}

export interface FeeRow {
  name: string
  kind: 'required' | 'opt_in'
  studentsBilled: number
  billed: number
  collected: number
  outstanding: number
  rate: number
  uptake: number
}

export interface DiscountRow {
  category: string
  discountCount: number
  studentCount: number
  estAmount: number
}

export interface RefundCategoryRow {
  category: string
  refundCount: number
  refundedAmount: number
}

export interface RefundMethodRow {
  method: string
  refundCount: number
  refundedAmount: number
}

export interface ClassRow {
  className: string
  studentsBilled: number
  billed: number
  collected: number
  outstanding: number
  rate: number
}

export interface FeeTrend {
  name: string
  kind: 'required' | 'opt_in'
  totalBilled: number
  points: { label: string; startDate: string; billed: number; collected: number }[]
}

export const rate = (collected: number, billed: number) =>
  billed > 0 ? Math.round((collected / billed) * 100) : 0

export const EMPTY_SUMMARY: Summary = {
  billed: 0, collected: 0, outstanding: 0, discountTotal: 0,
  grossPotential: 0, invoiceCount: 0, collectionRate: 0,
}

export function summarize(termSeries: TermPoint[], cycleIds: Set<string>): Summary {
  const s = termSeries
    .filter(t => cycleIds.has(t.cycleId))
    .reduce((acc, t) => ({
      billed: acc.billed + t.billed,
      collected: acc.collected + t.collected,
      outstanding: acc.outstanding + t.outstanding,
      discountTotal: acc.discountTotal + t.discountTotal,
      grossPotential: acc.grossPotential + t.grossPotential,
      invoiceCount: acc.invoiceCount + t.invoiceCount,
      collectionRate: 0,
    }), { ...EMPTY_SUMMARY })
  s.collectionRate = rate(s.collected, s.billed)
  return s
}

export function aggFees(feeSeries: FeeCyclePoint[], cycleIds: Set<string>, invoiceCount: number): FeeRow[] {
  const m = new Map<string, { name: string; kind: 'required' | 'opt_in'; studentsBilled: number; billed: number; collected: number }>()
  for (const f of feeSeries) {
    if (!cycleIds.has(f.cycleId)) continue
    const key = `${f.kind}::${f.name}`
    const e = m.get(key) || { name: f.name, kind: f.kind, studentsBilled: 0, billed: 0, collected: 0 }
    e.studentsBilled += f.studentsBilled
    e.billed += f.billed
    e.collected += f.collected
    m.set(key, e)
  }
  return Array.from(m.values())
    .map(f => ({
      ...f,
      outstanding: Math.max(0, f.billed - f.collected),
      rate: rate(f.collected, f.billed),
      uptake: invoiceCount > 0 ? Math.round((f.studentsBilled / invoiceCount) * 100) : 0,
    }))
    .sort((a, b) => b.billed - a.billed)
}

export function aggDiscounts(discountSeries: DiscountCyclePoint[], cycleIds: Set<string>): DiscountRow[] {
  const m = new Map<string, DiscountRow>()
  for (const d of discountSeries) {
    if (!cycleIds.has(d.cycleId)) continue
    const e = m.get(d.category) || { category: d.category, discountCount: 0, studentCount: 0, estAmount: 0 }
    e.discountCount += d.discountCount
    e.studentCount += d.studentCount
    e.estAmount += d.estAmount
    m.set(d.category, e)
  }
  return Array.from(m.values())
    .map(d => ({ ...d, estAmount: Math.round(d.estAmount) }))
    .sort((a, b) => b.estAmount - a.estAmount)
}

// Total money refunded in the selected scope — only 'completed' refunds ever
// reach refundSeries (see db/analytics_refund_series.sql), so this is real
// money that left, already netted out of `collected` upstream (a completed
// refund's negative payment row is what moved paid_amount down in the first
// place). Shown as its own figure so staff see WHY collected dipped, not just
// a quietly lower number.
export function sumRefunds(refundSeries: RefundCyclePoint[], cycleIds: Set<string>): number {
  return refundSeries.filter(r => cycleIds.has(r.cycleId)).reduce((sum, r) => sum + r.refundedAmount, 0)
}

export function aggRefundsByCategory(refundSeries: RefundCyclePoint[], cycleIds: Set<string>): RefundCategoryRow[] {
  const m = new Map<string, RefundCategoryRow>()
  for (const r of refundSeries) {
    if (!cycleIds.has(r.cycleId)) continue
    const e = m.get(r.category) || { category: r.category, refundCount: 0, refundedAmount: 0 }
    e.refundCount += r.refundCount
    e.refundedAmount += r.refundedAmount
    m.set(r.category, e)
  }
  return Array.from(m.values()).sort((a, b) => b.refundedAmount - a.refundedAmount)
}

// By method (Paystack API vs bank-transfer-with-proof) — operationally
// different: a Paystack reversal comes straight out of the settlement batch,
// a bank transfer is money the school has to actually wire out of its own
// account. Worth seeing separately, not just folded into one total.
export function aggRefundsByMethod(refundSeries: RefundCyclePoint[], cycleIds: Set<string>): RefundMethodRow[] {
  const m = new Map<string, RefundMethodRow>()
  for (const r of refundSeries) {
    if (!cycleIds.has(r.cycleId)) continue
    const e = m.get(r.method) || { method: r.method, refundCount: 0, refundedAmount: 0 }
    e.refundCount += r.refundCount
    e.refundedAmount += r.refundedAmount
    m.set(r.method, e)
  }
  return Array.from(m.values()).sort((a, b) => b.refundedAmount - a.refundedAmount)
}

export function aggClasses(classSeries: ClassCyclePoint[], cycleIds: Set<string>): ClassRow[] {
  const m = new Map<string, { className: string; studentsBilled: number; billed: number; collected: number; outstanding: number }>()
  for (const c of classSeries) {
    if (!cycleIds.has(c.cycleId)) continue
    const e = m.get(c.className) || { className: c.className, studentsBilled: 0, billed: 0, collected: 0, outstanding: 0 }
    e.studentsBilled += c.studentsBilled
    e.billed += c.billed
    e.collected += c.collected
    e.outstanding += c.outstanding
    m.set(c.className, e)
  }
  return Array.from(m.values())
    .map(c => ({ ...c, rate: rate(c.collected, c.billed) }))
    .sort((a, b) => b.billed - a.billed)
}

// Fee-over-time trends, clipped to the given cycle set (so the chart follows the
// selected range like everything else).
export function feeTrends(feeSeries: FeeCyclePoint[], cycleIds: Set<string>): FeeTrend[] {
  const m = new Map<string, FeeTrend>()
  for (const f of feeSeries) {
    if (!cycleIds.has(f.cycleId)) continue
    const key = `${f.kind}::${f.name}`
    const e: FeeTrend = m.get(key) || { name: f.name, kind: f.kind, totalBilled: 0, points: [] }
    e.totalBilled += f.billed
    e.points.push({ label: f.cycleName, startDate: f.startDate, billed: f.billed, collected: f.collected })
    m.set(key, e)
  }
  return Array.from(m.values())
    .map(t => ({ ...t, points: t.points.sort((a, b) => a.startDate.localeCompare(b.startDate)) }))
    .sort((a, b) => b.totalBilled - a.totalBilled)
}

// ---------------------------------------------------------------------------
// Fee price over time (the "fan" chart). For a chosen fee, one price line per
// class across the selected terms — so you can watch a fee climb year on year
// and see how it differs by class. A school-wide fee (single price) collapses
// to one line (uniform === true); a per-class fee fans out.
// ---------------------------------------------------------------------------

export interface FeeChoice {
  name: string
  kind: 'required' | 'opt_in'
  totalBilled: number
}

export interface FeePriceFan {
  classes: string[]
  points: { label: string; startDate: string; prices: Record<string, number | null> }[]
  uniform: boolean          // true when every class shares the same price at every term
}

// Fees present in the selected cycles, most-billed first — drives the picker.
export function feeChoices(feeClassSeries: FeeClassPoint[], cycleIds: Set<string>): FeeChoice[] {
  const m = new Map<string, FeeChoice>()
  for (const f of feeClassSeries) {
    if (!cycleIds.has(f.cycleId)) continue
    const key = `${f.kind}::${f.name}`
    const e = m.get(key) || { name: f.name, kind: f.kind, totalBilled: 0 }
    e.totalBilled += f.billed
    m.set(key, e)
  }
  return Array.from(m.values()).sort((a, b) => b.totalBilled - a.totalBilled)
}

export function feePriceFan(feeClassSeries: FeeClassPoint[], cycleIds: Set<string>, feeName: string): FeePriceFan {
  // cycle -> { label, startDate, class -> price }
  const byCycle = new Map<string, { label: string; startDate: string; prices: Map<string, number> }>()
  const classes = new Set<string>()
  for (const f of feeClassSeries) {
    if (!cycleIds.has(f.cycleId) || f.name !== feeName) continue
    classes.add(f.className)
    const c = byCycle.get(f.cycleId) || { label: f.cycleName, startDate: f.startDate, prices: new Map<string, number>() }
    c.prices.set(f.className, f.price)
    byCycle.set(f.cycleId, c)
  }
  const classList = Array.from(classes).sort()
  const points = Array.from(byCycle.values())
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map(c => ({
      label: c.label,
      startDate: c.startDate,
      prices: Object.fromEntries(classList.map(cl => [cl, c.prices.has(cl) ? c.prices.get(cl)! : null])),
    }))

  // Uniform when, at every term, all present class prices are equal.
  const uniform = points.every(p => {
    const vals = Object.values(p.prices).filter((v): v is number => v !== null)
    return vals.length === 0 || vals.every(v => v === vals[0])
  })

  return { classes: classList, points, uniform }
}
