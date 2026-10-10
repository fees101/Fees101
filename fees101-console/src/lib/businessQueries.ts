import { createServiceRoleClient } from './supabase/serviceRole'

// The owner's OWN business dashboard — Fees101's income, projections, who
// owes Fees101 money, a rough tax estimate, and platform-wide headcount, so
// the owner never has to open Paystack's own dashboard, a spreadsheet, or
// accounting software to answer "how is Fees101 doing as a business" (added
// 2026-10-10, see ROADMAP.md's "Console coverage pass"). Distinct from
// opsQueries.ts, which is cross-tenant SCHOOL-operations oversight — this
// file is Fees101-the-company's own numbers.
//
// At today's data volume (a handful of test schools, under 100 payment rows)
// these aggregate in plain JS after a bounded fetch. db/platform_business_overview.sql
// adds the equivalent as real SQL (SUM/GROUP BY) functions for when that stops
// being true — written, NOT YET RUN against live Supabase (same "written but
// not yet applied" pattern as other recent migrations in this repo) — this
// file does not depend on it existing, so it works today either way.

const PLATFORM_DEFAULT_PRICE_PER_STUDENT_MONTH = 500

function startOfMonthIso(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

function last30DaysIso(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
}

// ---------------------------------------------------------------------------
// Fees101's own revenue (cash collected from schools for using the platform).
// ---------------------------------------------------------------------------

export interface RevenueByMonth {
  month: string // 'YYYY-MM'
  amount: number
}

export interface SchoolRevenueRow {
  schoolId: string
  schoolName: string
  lifetimeRevenue: number
  lastPaidAt: string | null
}

export interface OverdueToUsRow {
  schoolId: string
  schoolName: string
  billingStatus: string
  amountOwed: number
  periodStart: string | null
  periodEnd: string | null
  nextChargeDueAt: string | null
}

export interface BusinessRevenue {
  allTime: number
  monthToDate: number
  last30Days: number
  byMonth: RevenueByMonth[] // last 6 complete months + current, oldest first
  byKind: { chargedBy: string; amount: number; count: number }[]
  bySchool: SchoolRevenueRow[] // sorted desc, top 10
  projectedMonthlyRunRate: number // sum of (active students × price/student/month) for schools currently on the accrual path — an MRR-style forward estimate, not a historical figure
  overdueToUs: OverdueToUsRow[]
  earliestChargeAt: string | null // oldest successful charge — used to annualize for the tax estimate
  monthsOfOperation: number // computed server-side at query time, so page components never call Date.now() during render
}

export async function getBusinessRevenue(): Promise<BusinessRevenue> {
  const supabase = createServiceRoleClient()
  const monthStart = startOfMonthIso()
  const since30d = last30DaysIso()

  const [{ data: charges }, { data: schools }, { data: billing }, { data: periods }, { data: students }] = await Promise.all([
    supabase.from('platform_billing_charges').select('school_id, amount, status, charged_by, paid_at, created_at').eq('status', 'success'),
    supabase.from('schools').select('id, name'),
    supabase.from('platform_billing').select('school_id, billing_status, price_per_student_month, onboarding_at, next_charge_due_at'),
    supabase.from('platform_billing_periods').select('school_id, period_start, period_end, amount_due, amount_paid, status').in('status', ['open', 'overdue', 'partial']),
    supabase.from('students').select('school_id').eq('status', 'active'),
  ])

  const nameBySchool = new Map((schools || []).map(s => [s.id as string, s.name as string]))
  const successfulCharges = charges || []

  const allTime = successfulCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const monthToDate = successfulCharges.filter(c => (c.paid_at || c.created_at) >= monthStart).reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  const last30Days = successfulCharges.filter(c => (c.paid_at || c.created_at) >= since30d).reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

  // By month, last 6 complete calendar months + the current one, oldest first.
  const byMonthMap = new Map<string, number>()
  successfulCharges.forEach(c => {
    const when = c.paid_at || c.created_at
    const key = when.slice(0, 7) // 'YYYY-MM'
    byMonthMap.set(key, (byMonthMap.get(key) || 0) + (Number(c.amount) || 0))
  })
  const now = new Date()
  const byMonth: RevenueByMonth[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = d.toISOString().slice(0, 7)
    byMonth.push({ month: key, amount: byMonthMap.get(key) || 0 })
  }

  const byKindMap = new Map<string, { amount: number; count: number }>()
  successfulCharges.forEach(c => {
    const key = c.charged_by || 'unknown'
    const existing = byKindMap.get(key) || { amount: 0, count: 0 }
    existing.amount += Number(c.amount) || 0
    existing.count += 1
    byKindMap.set(key, existing)
  })
  const byKind = Array.from(byKindMap.entries()).map(([chargedBy, v]) => ({ chargedBy, ...v })).sort((a, b) => b.amount - a.amount)

  const bySchoolMap = new Map<string, { amount: number; lastPaidAt: string | null }>()
  successfulCharges.forEach(c => {
    const existing = bySchoolMap.get(c.school_id) || { amount: 0, lastPaidAt: null }
    existing.amount += Number(c.amount) || 0
    const when = c.paid_at || c.created_at
    if (!existing.lastPaidAt || when > existing.lastPaidAt) existing.lastPaidAt = when
    bySchoolMap.set(c.school_id, existing)
  })
  const bySchool: SchoolRevenueRow[] = Array.from(bySchoolMap.entries())
    .map(([schoolId, v]) => ({ schoolId, schoolName: nameBySchool.get(schoolId) || 'Unknown school', lifetimeRevenue: v.amount, lastPaidAt: v.lastPaidAt }))
    .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue)
    .slice(0, 10)

  // Projected run-rate — reuses the SAME figures the per-school AccrualPanel/
  // the /billing page already compute (active students × that school's own
  // price/student/month), just summed across every school currently on the
  // accrual path (onboarding_at set). Deliberately NOT a second copy of the
  // accrual computation — see accrual.ts's getAllSchoolsBillingOverview for
  // the canonical per-school version this mirrors at the input level only.
  const activeBySchool = new Map<string, number>()
  ;(students || []).forEach(s => { activeBySchool.set(s.school_id, (activeBySchool.get(s.school_id) || 0) + 1) })
  const projectedMonthlyRunRate = (billing || [])
    .filter(b => !!b.onboarding_at && b.billing_status !== 'cancelled')
    .reduce((sum, b) => {
      const students = activeBySchool.get(b.school_id) || 0
      const price = Number(b.price_per_student_month ?? PLATFORM_DEFAULT_PRICE_PER_STUDENT_MONTH)
      return sum + students * price
    }, 0)

  // Overdue to us — open/overdue/partial billing periods (real unpaid
  // amount), surfaced for the owner's own cash-flow visibility. Distinct from
  // a PARENT owing a SCHOOL money, which is each school's own concern.
  const overdueToUs: OverdueToUsRow[] = (periods || [])
    .map(p => ({
      schoolId: p.school_id,
      schoolName: nameBySchool.get(p.school_id) || 'Unknown school',
      billingStatus: (billing || []).find(b => b.school_id === p.school_id)?.billing_status || 'unknown',
      amountOwed: Math.max(0, Number(p.amount_due || 0) - Number(p.amount_paid || 0)),
      periodStart: p.period_start,
      periodEnd: p.period_end,
      nextChargeDueAt: (billing || []).find(b => b.school_id === p.school_id)?.next_charge_due_at || null,
    }))
    .filter(r => r.amountOwed > 0)
    .sort((a, b) => b.amountOwed - a.amountOwed)

  const earliestChargeAt = successfulCharges.reduce<string | null>((earliest, c) => {
    const when = c.paid_at || c.created_at
    return !earliest || when < earliest ? when : earliest
  }, null)

  const monthsOfOperation = earliestChargeAt
    ? Math.max(1, Math.round((Date.now() - new Date(earliestChargeAt).getTime()) / (30 * 24 * 60 * 60 * 1000)))
    : 1

  return { allTime, monthToDate, last30Days, byMonth, byKind, bySchool, projectedMonthlyRunRate, overdueToUs, earliestChargeAt, monthsOfOperation }
}

// ---------------------------------------------------------------------------
// Platform-wide headcount / health stats — "how is the business doing"
// beyond revenue: tenants, students, families, gross volume, provider split.
// ---------------------------------------------------------------------------

export interface PlatformWideStats {
  totalSchools: number
  activeBillingSchools: number
  suspendedSchools: number
  totalActiveStudents: number
  totalFamilies: number
  paystackSchools: number
  monnifySchools: number
  unconfiguredSchools: number
  grossPaymentVolumeAllTime: number
  grossPaymentVolumeThisMonth: number
}

export async function getPlatformWideStats(): Promise<PlatformWideStats> {
  const supabase = createServiceRoleClient()
  const monthStart = startOfMonthIso()

  const [{ data: schools }, { data: billing }, { count: activeStudents }, { count: families }, { data: payments }] = await Promise.all([
    supabase.from('schools').select('id, payment_provider'),
    supabase.from('platform_billing').select('school_id, billing_status'),
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('families').select('id', { count: 'exact', head: true }),
    // Gross volume = what parents pay schools, not Fees101's own cut. amount > 0
    // excludes reversal rows (negative by construction, see payments_allow_reversal_amount.sql).
    supabase.from('payments').select('amount, created_at').gt('amount', 0),
  ])

  const totalSchools = (schools || []).length
  const activeBillingSchools = (billing || []).filter(b => b.billing_status === 'active').length
  const suspendedSchools = (billing || []).filter(b => b.billing_status === 'suspended').length
  const paystackSchools = (schools || []).filter(s => s.payment_provider === 'paystack').length
  const monnifySchools = (schools || []).filter(s => s.payment_provider === 'monnify').length
  const unconfiguredSchools = (schools || []).filter(s => !s.payment_provider).length

  const grossAll = (payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const grossMTD = (payments || []).filter(p => p.created_at >= monthStart).reduce((sum, p) => sum + (Number(p.amount) || 0), 0)

  return {
    totalSchools,
    activeBillingSchools,
    suspendedSchools,
    totalActiveStudents: activeStudents || 0,
    totalFamilies: families || 0,
    paystackSchools,
    monnifySchools,
    unconfiguredSchools,
    grossPaymentVolumeAllTime: grossAll,
    grossPaymentVolumeThisMonth: grossMTD,
  }
}

// ---------------------------------------------------------------------------
// Tax estimate — ESTIMATE ONLY, see the UI copy and ROADMAP.md for caveats.
// WebSearch was unavailable in this environment to verify current FIRS
// guidance (same structural failure ROADMAP.md records elsewhere for this
// workspace), so these rates are based on the Nigeria Tax Act 2025 (effective
// 2026) as understood without live verification: VAT 7.5%; companies with
// turnover at/under the small-company threshold are Companies Income Tax
// exempt, otherwise a flat higher band applies; a development levy applies
// above the small-company threshold. CONFIRM WITH AN ACCOUNTANT / FIRS before
// relying on any number this produces for an actual filing.
// ---------------------------------------------------------------------------

export const TAX_ASSUMPTIONS = {
  vatRate: 0.075,
  smallCompanyTurnoverThreshold: 50_000_000, // naira/year — CIT-exempt band
  citRateAboveThreshold: 0.30,
  developmentLevyRateAboveThreshold: 0.04,
}

export interface TaxEstimate {
  basisAnnualizedRevenue: number
  vatEstimate: number
  isLikelySmallCompany: boolean
  citEstimate: number
  developmentLevyEstimate: number
}

// Annualizes the trailing-12-month (or shorter, if younger) revenue actually
// collected, then applies the assumptions above. This is a rough planning
// figure, not a filing-ready number — it has no visibility into Fees101's
// actual deductible expenses (CIT applies to assessable PROFIT, not raw
// revenue), so the CIT/levy figures here are upper-bound-ish estimates
// assuming revenue ≈ profit, clearly flagged as such in the UI.
// ---------------------------------------------------------------------------
// Platform PROCESSING volume — distinct from Fees101's own revenue above.
// This is the ₦ Fees101 already pushes through Paystack/Monnify on behalf of
// schools (parents paying schools), owner request 2026-10-10: Fees101 is
// exploring aggregator/facilitator status with Paystack (and separately
// looked at this with Monnify), and making that case needs hard numbers on
// existing volume — this is leverage in that conversation, so it needs to be
// a real, live, on-demand number, not something someone has to go query raw
// tables for when the conversation happens.
//
// Prefers the real SQL-level GROUP BY (db/platform_processing_volume.sql) —
// PostgREST aggregate functions are disabled on this project (confirmed live:
// a direct `amount.sum()` select 400s with PGRST123 "aggregate functions not
// allowed"), so a Postgres function is the only way to get true server-side
// SUM/COUNT/GROUP BY here. That file is written but NOT YET RUN (this repo's
// standing rule — new SQL is additive and owner-run). Until it's run, falls
// back to one bounded, narrow-column fetch (provider/amount/created_at/
// school_id only, pre-filtered at the query level to provider IS NOT NULL
// AND amount > 0) and aggregates in JS — correct at today's data volume,
// same interim pattern already used elsewhere in this file. The moment the
// migration runs, this automatically switches to the SQL-level path with no
// code change needed.
// ---------------------------------------------------------------------------

export interface ProcessingVolumeByProvider {
  provider: string
  totalAmount: number
  txnCount: number
  firstPaymentAt: string | null
  lastPaymentAt: string | null
}

export interface ProcessingVolumeMonth {
  provider: string
  month: string // 'YYYY-MM'
  amount: number
  txnCount: number
}

export interface ProcessingActiveSchools {
  provider: string
  activeSchools: number
}

export interface PlatformProcessingVolume {
  byProvider: ProcessingVolumeByProvider[]
  totalAllTimeAmount: number
  totalAllTimeTxnCount: number
  byMonth: ProcessingVolumeMonth[] // trailing 12 complete months + current, by provider
  activeSchoolsThisMonth: ProcessingActiveSchools[]
  computedVia: 'sql' | 'fallback' // surfaced in the UI as a small footnote for transparency
}

export async function getPlatformProcessingVolume(): Promise<PlatformProcessingVolume> {
  const supabase = createServiceRoleClient()

  const [summaryRpc, byMonthRpc, activeSchoolsRpc] = await Promise.all([
    supabase.rpc('platform_processing_volume_summary'),
    supabase.rpc('platform_processing_volume_by_month', { p_months: 12 }),
    supabase.rpc('platform_processing_active_schools_this_month'),
  ])

  if (!summaryRpc.error && !byMonthRpc.error && !activeSchoolsRpc.error) {
    const byProvider: ProcessingVolumeByProvider[] = (summaryRpc.data || []).map((r: any) => ({
      provider: r.provider,
      totalAmount: Number(r.total_amount) || 0,
      txnCount: Number(r.txn_count) || 0,
      firstPaymentAt: r.first_payment_at,
      lastPaymentAt: r.last_payment_at,
    }))
    const byMonth: ProcessingVolumeMonth[] = (byMonthRpc.data || []).map((r: any) => ({
      provider: r.provider,
      month: String(r.month).slice(0, 7),
      amount: Number(r.amount) || 0,
      txnCount: Number(r.txn_count) || 0,
    }))
    const activeSchoolsThisMonth: ProcessingActiveSchools[] = (activeSchoolsRpc.data || []).map((r: any) => ({
      provider: r.provider,
      activeSchools: Number(r.active_schools) || 0,
    }))
    return {
      byProvider,
      totalAllTimeAmount: byProvider.reduce((s, p) => s + p.totalAmount, 0),
      totalAllTimeTxnCount: byProvider.reduce((s, p) => s + p.txnCount, 0),
      byMonth,
      activeSchoolsThisMonth,
      computedVia: 'sql',
    }
  }

  // Fallback — migration not run yet. One bounded, narrow-column fetch.
  const { data: rows } = await supabase
    .from('payments')
    .select('provider, amount, created_at, school_id')
    .not('provider', 'is', null)
    .gt('amount', 0)

  const paymentRows = rows || []

  const byProviderMap = new Map<string, { amount: number; count: number; first: string; last: string }>()
  const byMonthMap = new Map<string, { provider: string; month: string; amount: number; count: number }>()
  const activeSchoolsMap = new Map<string, Set<string>>()
  const monthStart = startOfMonthIso().slice(0, 10)

  paymentRows.forEach((p: any) => {
    const provider = p.provider as string
    const amount = Number(p.amount) || 0
    const createdAt = p.created_at as string

    const existing = byProviderMap.get(provider) || { amount: 0, count: 0, first: createdAt, last: createdAt }
    existing.amount += amount
    existing.count += 1
    if (createdAt < existing.first) existing.first = createdAt
    if (createdAt > existing.last) existing.last = createdAt
    byProviderMap.set(provider, existing)

    const monthKey = createdAt.slice(0, 7)
    const compositeKey = `${provider}::${monthKey}`
    const monthExisting = byMonthMap.get(compositeKey) || { provider, month: monthKey, amount: 0, count: 0 }
    monthExisting.amount += amount
    monthExisting.count += 1
    byMonthMap.set(compositeKey, monthExisting)

    if (createdAt.slice(0, 10) >= monthStart) {
      if (!activeSchoolsMap.has(provider)) activeSchoolsMap.set(provider, new Set())
      activeSchoolsMap.get(provider)!.add(p.school_id as string)
    }
  })

  const byProvider: ProcessingVolumeByProvider[] = Array.from(byProviderMap.entries())
    .map(([provider, v]) => ({ provider, totalAmount: v.amount, txnCount: v.count, firstPaymentAt: v.first, lastPaymentAt: v.last }))
    .sort((a, b) => a.provider.localeCompare(b.provider))

  // Trailing 12 complete months + current, zero-filled so a quiet month still
  // shows as a bar rather than disappearing from the trend.
  const now = new Date()
  const providers = byProvider.map(p => p.provider)
  const byMonth: ProcessingVolumeMonth[] = []
  for (let i = 12; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = d.toISOString().slice(0, 7)
    providers.forEach(provider => {
      const found = byMonthMap.get(`${provider}::${key}`)
      byMonth.push({ provider, month: key, amount: found?.amount || 0, txnCount: found?.count || 0 })
    })
  }

  const activeSchoolsThisMonth: ProcessingActiveSchools[] = Array.from(activeSchoolsMap.entries())
    .map(([provider, schoolSet]) => ({ provider, activeSchools: schoolSet.size }))
    .sort((a, b) => a.provider.localeCompare(b.provider))

  return {
    byProvider,
    totalAllTimeAmount: byProvider.reduce((s, p) => s + p.totalAmount, 0),
    totalAllTimeTxnCount: byProvider.reduce((s, p) => s + p.txnCount, 0),
    byMonth,
    activeSchoolsThisMonth,
    computedVia: 'fallback',
  }
}

export function estimateTax(allTimeRevenue: number, monthsOfOperation: number): TaxEstimate {
  const months = Math.max(1, monthsOfOperation)
  const monthlyAverage = allTimeRevenue / months
  const basisAnnualizedRevenue = monthlyAverage * 12
  const vatEstimate = basisAnnualizedRevenue * TAX_ASSUMPTIONS.vatRate
  const isLikelySmallCompany = basisAnnualizedRevenue <= TAX_ASSUMPTIONS.smallCompanyTurnoverThreshold
  const citEstimate = isLikelySmallCompany ? 0 : basisAnnualizedRevenue * TAX_ASSUMPTIONS.citRateAboveThreshold
  const developmentLevyEstimate = isLikelySmallCompany ? 0 : basisAnnualizedRevenue * TAX_ASSUMPTIONS.developmentLevyRateAboveThreshold
  return { basisAnnualizedRevenue, vatEstimate, isLikelySmallCompany, citEstimate, developmentLevyEstimate }
}

// ---------------------------------------------------------------------------
// Provider fee REVENUE — distinct from platform processing VOLUME above.
// This is how much of that volume Paystack/Monnify keep as their own
// processing fee, not the gross ₦ moved. Owner's own framing (2026-10-10
// follow-up): "if ₦1,000,000 has been transacted, the number that matters is
// how much Paystack kept as fee (e.g. ₦30,000) — because that's the revenue
// Fees101 could capture/redirect if it became the aggregator instead."
// Backs /health/provider-fees.
//
// Fed by payments.provider_fee (fees101-web's db/payment_provider_fee.sql),
// populated from each provider's own REAL per-transaction fee (Paystack's
// webhook/verify `data.fees`, Monnify's `settlementAmount`) — never a
// guessed percentage, which would be wrong for DVA/transfer vs. card vs. USSD.
// Rows from before that capture existed are backfilled by fees101-web's
// src/lib/payments/backfillProviderFees.ts, called via its
// /api/admin/backfill-provider-fees route — until that's run (or for a row
// the provider itself can't verify, e.g. a pre-launch test reference), the
// row stays fee-less, which is why every total here is reported ALONGSIDE a
// coverage count rather than silently treating a missing fee as ₦0.
//
// Prefers db/platform_provider_fee_revenue.sql's real SQL-level GROUP BY —
// same PostgREST-aggregate-functions-disabled reasoning as
// getPlatformProcessingVolume above. That file is written but NOT YET RUN
// (standing rule: new SQL is additive and owner-run). Until it's run, falls
// back to one bounded, narrow-column fetch (payments: school_id/provider/
// provider_reference/amount/provider_fee/created_at, pre-filtered to
// provider IS NOT NULL AND amount > 0; schools: id/name) and aggregates in
// JS — correct at today's data volume, same interim pattern as above. The
// moment the migration runs, this automatically switches to the SQL path.
//
// "Transaction count" is count(DISTINCT provider_reference), never a raw row
// count — one real transfer can produce several `payments` rows (split
// across invoices / overflow into credit), and provider_fee is only ever
// stamped on ONE of those rows per transaction (fees101-web's
// applyPayment.ts), so summing provider_fee never double-counts, but
// counting *rows* would overstate how many real transfers happened. `amount`
// IS safe to sum across every row — each is a genuine split of one real
// transaction's total, not a repeat of it.

export interface ProviderFeeRevenueByProvider {
  provider: string
  feeRevenue: number
  grossVolume: number
  txnsWithFee: number
  txnsTotal: number
  effectiveRate: number | null // feeRevenue / grossVolume — sanity-check against the provider's published fee schedule
  firstPaymentAt: string | null
  lastPaymentAt: string | null
}

export interface ProviderFeeRevenueMonth {
  provider: string
  month: string // 'YYYY-MM'
  feeRevenue: number
  volume: number
  txnCount: number
}

export interface ProviderFeeRevenueSchoolRow {
  schoolId: string
  schoolName: string
  provider: string
  feeRevenue: number
  grossVolume: number
  txnsWithFee: number
  txnsTotal: number
}

export interface PlatformProviderFeeRevenue {
  byProvider: ProviderFeeRevenueByProvider[]
  totalFeeRevenue: number
  totalGrossVolume: number
  totalTxnsWithFee: number
  totalTxnsTotal: number
  byMonth: ProviderFeeRevenueMonth[] // whatever trailing-12-month rows have activity, by provider — not zero-filled (same as getPlatformProcessingVolume's SQL path); the page zero-fills for the chart
  bySchool: ProviderFeeRevenueSchoolRow[] // sorted desc by feeRevenue — "biggest accounts" as much as an aggregator-pitch input
  computedVia: 'sql' | 'fallback'
}

export async function getProviderFeeRevenue(): Promise<PlatformProviderFeeRevenue> {
  const supabase = createServiceRoleClient()

  const [summaryRpc, byMonthRpc, bySchoolRpc] = await Promise.all([
    supabase.rpc('platform_provider_fee_revenue_summary'),
    supabase.rpc('platform_provider_fee_revenue_by_month', { p_months: 12 }),
    supabase.rpc('platform_provider_fee_revenue_by_school'),
  ])

  if (!summaryRpc.error && !byMonthRpc.error && !bySchoolRpc.error) {
    const byProvider: ProviderFeeRevenueByProvider[] = (summaryRpc.data || []).map((r: any) => {
      const grossVolume = Number(r.gross_volume) || 0
      const feeRevenue = Number(r.fee_revenue) || 0
      return {
        provider: r.provider,
        feeRevenue,
        grossVolume,
        txnsWithFee: Number(r.txns_with_fee) || 0,
        txnsTotal: Number(r.txns_total) || 0,
        effectiveRate: grossVolume > 0 ? feeRevenue / grossVolume : null,
        firstPaymentAt: r.first_payment_at,
        lastPaymentAt: r.last_payment_at,
      }
    })
    const byMonth: ProviderFeeRevenueMonth[] = (byMonthRpc.data || []).map((r: any) => ({
      provider: r.provider,
      month: String(r.month).slice(0, 7),
      feeRevenue: Number(r.fee_revenue) || 0,
      volume: Number(r.volume) || 0,
      txnCount: Number(r.txn_count) || 0,
    }))
    const bySchool: ProviderFeeRevenueSchoolRow[] = (bySchoolRpc.data || []).map((r: any) => ({
      schoolId: r.school_id,
      schoolName: r.school_name,
      provider: r.provider,
      feeRevenue: Number(r.fee_revenue) || 0,
      grossVolume: Number(r.gross_volume) || 0,
      txnsWithFee: Number(r.txns_with_fee) || 0,
      txnsTotal: Number(r.txns_total) || 0,
    }))
    return {
      byProvider,
      totalFeeRevenue: byProvider.reduce((s, p) => s + p.feeRevenue, 0),
      totalGrossVolume: byProvider.reduce((s, p) => s + p.grossVolume, 0),
      totalTxnsWithFee: byProvider.reduce((s, p) => s + p.txnsWithFee, 0),
      totalTxnsTotal: byProvider.reduce((s, p) => s + p.txnsTotal, 0),
      byMonth,
      bySchool,
      computedVia: 'sql',
    }
  }

  // Fallback — migration not run yet. Two bounded, narrow-column fetches.
  const [{ data: rows }, { data: schools }] = await Promise.all([
    supabase
      .from('payments')
      .select('school_id, provider, provider_reference, amount, provider_fee, created_at')
      .not('provider', 'is', null)
      .gt('amount', 0),
    supabase.from('schools').select('id, name'),
  ])

  const nameBySchool = new Map((schools || []).map((s: any) => [s.id as string, s.name as string]))
  const paymentRows = rows || []

  const providerAgg = new Map<string, { feeRevenue: number; grossVolume: number; refsWithFee: Set<string>; refsTotal: Set<string>; first: string; last: string }>()
  const monthAgg = new Map<string, { feeRevenue: number; volume: number; refs: Set<string> }>()
  const schoolAgg = new Map<string, { schoolId: string; schoolName: string; provider: string; feeRevenue: number; grossVolume: number; refsWithFee: Set<string>; refsTotal: Set<string> }>()

  paymentRows.forEach((r: any) => {
    const provider = r.provider as string
    const amount = Number(r.amount) || 0
    const fee = r.provider_fee === null || r.provider_fee === undefined ? null : Number(r.provider_fee)
    const ref = (r.provider_reference as string) || `__unreferenced::${r.school_id}::${r.created_at}`
    const createdAt = r.created_at as string

    const p = providerAgg.get(provider) || { feeRevenue: 0, grossVolume: 0, refsWithFee: new Set<string>(), refsTotal: new Set<string>(), first: createdAt, last: createdAt }
    p.grossVolume += amount
    if (fee !== null) { p.feeRevenue += fee; p.refsWithFee.add(ref) }
    p.refsTotal.add(ref)
    if (createdAt < p.first) p.first = createdAt
    if (createdAt > p.last) p.last = createdAt
    providerAgg.set(provider, p)

    const monthKey = createdAt.slice(0, 7)
    const mKey = `${provider}::${monthKey}`
    const m = monthAgg.get(mKey) || { feeRevenue: 0, volume: 0, refs: new Set<string>() }
    m.volume += amount
    if (fee !== null) m.feeRevenue += fee
    m.refs.add(ref)
    monthAgg.set(mKey, m)

    const sKey = `${r.school_id}::${provider}`
    const sc = schoolAgg.get(sKey) || {
      schoolId: r.school_id as string,
      schoolName: nameBySchool.get(r.school_id as string) || 'Unknown school',
      provider,
      feeRevenue: 0,
      grossVolume: 0,
      refsWithFee: new Set<string>(),
      refsTotal: new Set<string>(),
    }
    sc.grossVolume += amount
    if (fee !== null) { sc.feeRevenue += fee; sc.refsWithFee.add(ref) }
    sc.refsTotal.add(ref)
    schoolAgg.set(sKey, sc)
  })

  const byProvider: ProviderFeeRevenueByProvider[] = Array.from(providerAgg.entries())
    .map(([provider, v]) => ({
      provider,
      feeRevenue: v.feeRevenue,
      grossVolume: v.grossVolume,
      txnsWithFee: v.refsWithFee.size,
      txnsTotal: v.refsTotal.size,
      effectiveRate: v.grossVolume > 0 ? v.feeRevenue / v.grossVolume : null,
      firstPaymentAt: v.first,
      lastPaymentAt: v.last,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider))

  const byMonth: ProviderFeeRevenueMonth[] = Array.from(monthAgg.entries()).map(([key, v]) => {
    const [provider, month] = key.split('::')
    return { provider, month, feeRevenue: v.feeRevenue, volume: v.volume, txnCount: v.refs.size }
  })

  const bySchool: ProviderFeeRevenueSchoolRow[] = Array.from(schoolAgg.values())
    .map((v) => ({
      schoolId: v.schoolId,
      schoolName: v.schoolName,
      provider: v.provider,
      feeRevenue: v.feeRevenue,
      grossVolume: v.grossVolume,
      txnsWithFee: v.refsWithFee.size,
      txnsTotal: v.refsTotal.size,
    }))
    .sort((a, b) => b.feeRevenue - a.feeRevenue)

  return {
    byProvider,
    totalFeeRevenue: byProvider.reduce((s, p) => s + p.feeRevenue, 0),
    totalGrossVolume: byProvider.reduce((s, p) => s + p.grossVolume, 0),
    totalTxnsWithFee: byProvider.reduce((s, p) => s + p.txnsWithFee, 0),
    totalTxnsTotal: byProvider.reduce((s, p) => s + p.txnsTotal, 0),
    byMonth,
    bySchool,
    computedVia: 'fallback',
  }
}
