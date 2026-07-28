// Computes what discounts apply to a student's invoice at generation time —
// sibling discounts (auto-detected via families, no approval needed) and
// carried-forward recurring manual discounts (staff/scholarship/bursary/etc
// that were already approved for a prior invoice and marked recurring).
//
// One-off manual discounts (is_recurring = false) are NOT handled here —
// they're requested/approved directly against an already-generated invoice
// (see src/app/(app)/invoices/[id]/discountActions.ts) since `discounts.invoice_id`
// is required not-null, so a discount can't exist before its target invoice does.

import type { DiscountSettings, SiblingTier } from '@/lib/queries/discounts'

export interface AppliedDiscount {
  category: string
  isPercentage: boolean
  // The rule value as stored on a `discounts` row — a % (<=100) when
  // isPercentage, otherwise a fixed Naira amount.
  rawAmount: number
  // The actual currency amount subtracted from this specific invoice.
  computedAmount: number
  reason: string
  isRecurring: boolean
  carriedForwardFromId?: string
  // True for a manual one-off discount already approved+applied directly
  // against this exact invoice (see invoice-detail discount actions) — it's
  // already a `discounts` row, so recordAppliedDiscounts must not re-insert it.
  alreadyPersisted?: boolean
}

export interface DiscountComputation {
  discountAmount: number
  discountReason: string
  appliedDiscounts: AppliedDiscount[]
}

const CATEGORY_LABELS: Record<string, string> = {
  sibling_discount: 'Sibling discount',
  staff_child: 'Staff-child discount',
  scholarship: 'Scholarship',
  bursary: 'Bursary',
  financial_hardship: 'Financial hardship discount',
  fee_waiver: 'Fee waiver',
  other: 'Discount',
}

// Ranks active siblings in the same family by admission date (oldest = 1st
// child, always full price), tie-broken by created_at for siblings admitted
// on the same date (e.g. a bulk import or twins) — not a perfect signal, but
// deterministic until a proper date_of_birth field exists. Returns the tier
// this student's rank maps to via the school's configured tiers (index 0 =
// 2nd child, since the 1st child never gets a stored slot). Returns null if
// the student has no family, is an only/eldest child in it, or the mapped
// tier's value is 0.
export async function computeSiblingDiscount(
  supabase: any,
  schoolId: string,
  student: { id: string; family_id: string | null },
  siblingTiers: SiblingTier[]
): Promise<SiblingTier | null> {
  if (!student.family_id || siblingTiers.length === 0) return null

  const { data: siblings } = await supabase
    .from('students')
    .select('id, admission_date')
    .eq('school_id', schoolId)
    .eq('family_id', student.family_id)
    .eq('status', 'active')
    .order('admission_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (!siblings || siblings.length < 2) return null

  const rank = siblings.findIndex((s: any) => s.id === student.id)
  if (rank <= 0) return null // 1st/eldest child is always full price

  const tier = siblingTiers[Math.min(rank - 1, siblingTiers.length - 1)]
  return tier && tier.value > 0 ? tier : null
}

// Manual discounts already approved for a PRIOR invoice and flagged
// recurring — these carry forward automatically to this new invoice without
// a fresh approval, one row per category (most recent wins if there were
// several over time, e.g. a since-updated staff discount %).
export async function getRecurringDiscounts(
  supabase: any,
  schoolId: string,
  studentId: string
): Promise<any[]> {
  const { data } = await supabase
    .from('discounts')
    .select('id, category, amount, is_percentage, reason')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('is_recurring', true)
    .in('status', ['approved', 'applied'])
    .order('created_at', { ascending: false })

  const seenCategories = new Set<string>()
  const latestPerCategory: any[] = []
  for (const row of data || []) {
    if (seenCategories.has(row.category)) continue
    seenCategories.add(row.category)
    latestPerCategory.push(row)
  }
  return latestPerCategory
}

// subtotal = this term's fees only (mandatory + opted-in), BEFORE any
// carried-forward previous balance is added — that's the base percentage
// discounts are computed against. A staff/sibling/scholarship discount is a
// break on this term's fees, not a write-down of debt the parent already
// owed from a prior term, so previous balance must never shrink because of
// it. The caller adds previousBalance back in untouched after subtracting
// discountAmount from this subtotal.
//
// existingInvoiceId: when regenerating an already-generated invoice, pass
// its id so any manual one-off discount already approved+applied directly
// against THIS invoice (via the invoice-detail request/approve flow) is
// folded back in — otherwise a regenerate would silently wipe it out, since
// this function's own sibling/recurring logic knows nothing about it.
export async function computeDiscountsForInvoice(
  supabase: any,
  schoolId: string,
  student: { id: string; family_id: string | null },
  subtotal: number,
  settings: DiscountSettings,
  existingInvoiceId?: string
): Promise<DiscountComputation> {
  const applied: AppliedDiscount[] = []

  const siblingTier = await computeSiblingDiscount(supabase, schoolId, student, settings.siblingTiers)
  if (siblingTier) {
    const computedAmount = siblingTier.isPercentage
      ? Math.round((subtotal * siblingTier.value) / 100)
      : siblingTier.value
    applied.push({
      category: 'sibling_discount',
      isPercentage: siblingTier.isPercentage,
      rawAmount: siblingTier.value,
      computedAmount,
      reason: `${CATEGORY_LABELS.sibling_discount} (${siblingTier.isPercentage ? `${siblingTier.value}%` : `₦${siblingTier.value.toLocaleString('en-NG')}`}, auto-applied)`,
      isRecurring: false,
    })
  }

  const recurring = await getRecurringDiscounts(supabase, schoolId, student.id)
  for (const row of recurring) {
    const computedAmount = row.is_percentage ? Math.round((subtotal * Number(row.amount)) / 100) : Number(row.amount)
    if (computedAmount <= 0) continue
    applied.push({
      category: row.category,
      isPercentage: row.is_percentage,
      rawAmount: Number(row.amount),
      computedAmount,
      reason: `${CATEGORY_LABELS[row.category] || row.category} (carried forward)`,
      isRecurring: true,
      carriedForwardFromId: row.id,
      // The approved row itself (found by getRecurringDiscounts, keyed on
      // is_recurring/status — not tied to any one invoice) is already the
      // persisted record; recordAppliedDiscounts must not insert a second
      // "audit copy" of it every regenerate, or duplicates pile up forever.
      alreadyPersisted: true,
    })
  }

  if (existingInvoiceId) {
    const { data: manualRows } = await supabase
      .from('discounts')
      .select('amount, is_percentage, category, reason')
      .eq('school_id', schoolId)
      .eq('invoice_id', existingInvoiceId)
      .eq('status', 'applied')
      .eq('is_recurring', false)
      .not('requested_by', 'is', null)

    for (const row of manualRows || []) {
      const computedAmount = row.is_percentage ? Math.round((subtotal * Number(row.amount)) / 100) : Number(row.amount)
      if (computedAmount <= 0) continue
      applied.push({
        category: row.category,
        isPercentage: row.is_percentage,
        rawAmount: Number(row.amount),
        computedAmount,
        reason: row.reason,
        isRecurring: false,
        alreadyPersisted: true,
      })
    }
  }

  // Additive, not compounding — a sibling + staff discount adds their two
  // percentages together rather than applying one on top of the other.
  // Capped at the subtotal itself so combined discounts (however many stack)
  // can never exceed 100% of this term's fees or push the total negative.
  const discountAmount = Math.min(subtotal, applied.reduce((s, a) => s + a.computedAmount, 0))
  const discountReason = applied.map(a => a.reason).join('; ')

  return { discountAmount, discountReason, appliedDiscounts: applied }
}

// Writes the audit trail once an invoice has actually been persisted and its
// id is known — one `discounts` row per system-computed applied discount
// (sibling / carried-forward recurring). Already-persisted manual discounts
// are skipped. Clears any previously system-generated rows for this invoice
// first, so re-running generation (regenerate) doesn't accumulate duplicates.
export async function recordAppliedDiscounts(
  supabase: any,
  schoolId: string,
  studentId: string,
  invoiceId: string,
  appliedDiscounts: AppliedDiscount[]
): Promise<void> {
  await supabase
    .from('discounts')
    .delete()
    .eq('invoice_id', invoiceId)
    .is('requested_by', null)

  const toInsert = appliedDiscounts.filter(d => !d.alreadyPersisted)
  if (toInsert.length === 0) return

  const now = new Date().toISOString()
  await supabase.from('discounts').insert(
    toInsert.map(d => ({
      school_id: schoolId,
      invoice_id: invoiceId,
      student_id: studentId,
      amount: d.rawAmount,
      is_percentage: d.isPercentage,
      is_recurring: d.isRecurring,
      category: d.category,
      reason: d.reason,
      status: 'applied',
      requested_at: now,
      applied_at: now,
    }))
  )
}
