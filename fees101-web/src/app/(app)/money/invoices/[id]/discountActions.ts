'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { getDiscountSettingsFor } from '@/lib/queries/discounts'
import { claimAndApplyDiscount } from '@/lib/discounts/apply'

const CATEGORIES = ['staff_child', 'scholarship', 'bursary', 'financial_hardship', 'fee_waiver', 'other'] as const
export type ManualDiscountCategory = typeof CATEGORIES[number]

const CATEGORY_LABELS: Record<ManualDiscountCategory, string> = {
  staff_child: 'Staff-child discount',
  scholarship: 'Scholarship',
  bursary: 'Bursary',
  financial_hardship: 'Financial hardship discount',
  fee_waiver: 'Fee waiver',
  other: 'Discount',
}

async function getContext() {
  // Gated on the 'request-discounts' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('request-discounts')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

interface RequestDiscountInput {
  category: ManualDiscountCategory
  // Only used for categories other than staff_child — these genuinely vary
  // per student/circumstance (a scholarship isn't the same % for everyone),
  // so the requester sets them per request, same as before the staff-child
  // scope setting existed.
  amount?: number
  isPercentage?: boolean
  isRecurring?: boolean
  reason: string
}

// staff_child is the one category with a school-wide fixed rate (Discount
// policy's staffDiscountDefaultPct) — not something a requester can override,
// since it's meant to be the same benefit for any staff member's child.
// Every other category varies by student, so its value/unit/recurring come
// from the request itself, validated here rather than trusted blindly.
function resolveDiscountAmount(
  category: ManualDiscountCategory,
  settings: Awaited<ReturnType<typeof getDiscountSettingsFor>>,
  input: RequestDiscountInput
): { amount: number; isPercentage: boolean; isRecurring: boolean } | { error: string } {
  if (category === 'staff_child') {
    const amount = settings.staffDiscountDefaultPct
    if (!(amount > 0)) {
      return { error: 'Staff-child discount has no percentage configured yet — set one on the Discount policy page first.' }
    }
    return { amount, isPercentage: true, isRecurring: true }
  }
  const amount = Number(input.amount)
  if (!(amount > 0)) return { error: 'Enter a discount amount' }
  const isPercentage = !!input.isPercentage
  if (isPercentage && amount > 100) return { error: 'Percentage discounts cannot exceed 100%' }
  return { amount, isPercentage, isRecurring: !!input.isRecurring }
}

// Manual discounts (staff-child, scholarship, bursary, hardship, waiver) are
// requested against an already-generated invoice — `discounts.invoice_id` is
// NOT NULL, so a request can't exist as a standing entitlement ahead of one.
// It lands as `pending`; a school_admin must approve it from /discounts
// before it affects any total.
export async function requestDiscount(invoiceId: string, input: RequestDiscountInput) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  if (!CATEGORIES.includes(input.category)) return { error: 'Invalid category' }
  if (input.reason.trim().length < 20) return { error: 'Reason must be at least 20 characters' }

  // staff_child's rate always comes from Discount policy, never the client;
  // every other category's amount/unit/recurring is the requester's own
  // input, validated here.
  const settings = await getDiscountSettingsFor(supabase, schoolId)
  const resolved = resolveDiscountAmount(input.category, settings, input)
  if ('error' in resolved) return resolved
  const { amount, isPercentage, isRecurring } = resolved

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, student_id, status, paid_amount, line_items, billing_cycles(status), students(first_name, last_name)')
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()
  if (!invoice) return { error: 'Invoice not found' }
  if (invoice.status === 'cancelled') return { error: 'This invoice is cancelled.' }
  if (Number(invoice.paid_amount || 0) > 0) {
    return { error: 'This invoice already has a payment against it, so discounts can no longer be applied to it.' }
  }

  if ((invoice.billing_cycles as any)?.status === 'closed') {
    const { data: successor } = await supabase
      .from('invoices')
      .select('id, billing_cycles(name)')
      .eq('previous_balance_from_invoice_id', invoiceId)
      .eq('school_id', schoolId)
      .maybeSingle()
    if (successor) {
      const cycleName = (successor.billing_cycles as any)?.name
      return {
        error: `This balance carried forward to ${cycleName || 'a later term'} — request the discount on that invoice instead. A discount here won't reduce what's actually owed.`,
      }
    }
  }

  const { data: existingPending } = await supabase
    .from('discounts')
    .select('id')
    .eq('invoice_id', invoiceId)
    .eq('status', 'pending')
    .maybeSingle()
  if (existingPending) {
    return { error: 'A discount request is already pending on this invoice.' }
  }

  const { data: created, error } = await supabase.from('discounts').insert({
    school_id: schoolId,
    invoice_id: invoiceId,
    student_id: invoice.student_id,
    amount,
    is_percentage: isPercentage,
    is_recurring: isRecurring,
    category: input.category,
    reason: input.reason.trim(),
    status: 'pending',
    requested_by: userId,
  }).select('id').single()
  if (error) return { error: error.message }

  const student = (invoice as any).students as { first_name?: string; last_name?: string } | null
  const studentName = student ? `${student.first_name || ''} ${student.last_name || ''}`.trim() : null
  const amountLabel = isPercentage ? `${amount}%` : `₦${amount}`

  // Threshold-based auto-approval: a school can set a ₦ ceiling below which
  // a discount clears the instant it's requested, no approve click needed —
  // the owner reviews/revokes from /discounts after the fact if one turns
  // out to be wrong. No threshold set = every discount waits for a human
  // approver, same as before this feature existed.
  let autoApproved = false
  const threshold = settings.approval.thresholdNaira
  if (threshold !== null) {
    // Face-value estimate using this invoice's own stored line items — a
    // conservative one, since a percentage discount stacked with others can
    // end up capped lower once actually applied, but never higher. So this
    // can only ever be too cautious about auto-approving, never too loose.
    // Uses the full subtotal as the base for a full-invoice-scoped
    // staff-child discount, discountable-only for every other case — same
    // branch computeDiscountsForInvoice itself uses at actual apply time.
    const lineItems = (invoice as any).line_items || []
    const useFullSubtotal = input.category === 'staff_child' && settings.staffDiscountScope === 'full_invoice'
    const estimateBase = lineItems
      .filter((li: any) => li.kind !== 'previous_balance' && (useFullSubtotal || li.discountable !== false))
      .reduce((s: number, li: any) => s + Number(li.amount || 0), 0)
    const faceValue = isPercentage ? Math.round((estimateBase * amount) / 100) : amount
    if (faceValue <= threshold) {
      const applied = await claimAndApplyDiscount(supabase, schoolId, created!.id, null)
      // If this fails (e.g. a payment landed in the instant between the
      // insert above and this call), claimAndApplyDiscount already leaves
      // the discount row back at 'pending' — fall through to the normal
      // "awaiting approval" outcome rather than failing a request that, from
      // the requester's point of view, already succeeded.
      autoApproved = 'success' in applied
    }
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: autoApproved ? 'discount.auto_approved' : 'discount.requested',
    targetType: 'discount',
    targetId: created?.id,
    summary: autoApproved
      ? `Auto-approved a ${amountLabel} ${input.category} discount${studentName ? ` for ${studentName}` : ''} on invoice ${invoiceId} — below the ₦${threshold?.toLocaleString('en-NG')} threshold`
      : `Requested a ${amountLabel} ${input.category} discount${studentName ? ` for ${studentName}` : ''} on invoice ${invoiceId}`,
    metadata: {
      invoiceId,
      studentId: invoice.student_id,
      category: input.category,
      amount,
      isPercentage,
      isRecurring,
      autoApproved,
    },
  })

  revalidatePath(`/money/invoices/${invoiceId}`)
  if (autoApproved) {
    revalidatePath('/discounts')
    revalidatePath(`/students/${invoice.student_id}`)
  }
  return { success: true, autoApproved }
}
