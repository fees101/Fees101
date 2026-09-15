// Additive-only delta engine: appends a single opted-in fee to a student's
// current-cycle invoice, if one already exists. Deliberately narrow — it only
// ever appends a new line and increases the total, never re-derives or
// touches any existing line (credit_applied, previous_balance are left
// exactly as they are). That's what makes it safe to run regardless of
// sent_at/paid_amount: there's no refund/clawback risk on an addition, so
// unlike a full regenerate it needs no sent/paid gate at all.
//
// Discount is the one exception: it IS recomputed, because a discountable
// fee added to a student with an active sibling/staff percentage discount
// must get its share of that discount too, same as it would if the whole
// invoice were regenerated — otherwise the new item would silently bill at
// full price. Recomputing can only ever increase discount_amount (same
// rates, larger discountable base), so it can only reduce what's newly
// owed — never claws back anything the parent already paid.
//
// Called from toggleStudentOptIn's opt-in branch (students/[id]/actions.ts).
// Opt-outs never call this — a deduction only ever affects the *next*
// invoice generation, never the current one.
import { logAuditEvent } from '@/lib/audit/logAudit'
import { computeDiscountsForInvoice, recordAppliedDiscounts } from '@/lib/discounts/compute'
import { getDiscountSettingsFor } from '@/lib/queries/discounts'

export async function applyOptInAdditionToLiveInvoice(
  supabase: any,
  schoolId: string,
  actorId: string,
  studentId: string,
  feeItemId: string
): Promise<{ applied: boolean }> {
  const { data: feeItem } = await supabase
    .from('fee_items')
    .select('id, name, amount, billing_cycle_id, is_optional_extra, is_discountable')
    .eq('id', feeItemId)
    .eq('school_id', schoolId)
    .single()

  // Only optional-extra fees go through opt-in toggling at all; a mandatory
  // fee has no "current invoice" gap to fill here.
  if (!feeItem || !feeItem.is_optional_extra) return { applied: false }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, line_items, subtotal, discount_amount, total_amount, paid_amount, outstanding_amount, sent_at')
    .eq('student_id', studentId)
    .eq('billing_cycle_id', feeItem.billing_cycle_id)
    .eq('school_id', schoolId)
    .maybeSingle()

  // No invoice generated yet for this term — the next generation run reads
  // opt-ins live, so it picks this up naturally with no special handling.
  if (!invoice) return { applied: false }

  const lineItems: any[] = Array.isArray(invoice.line_items) ? invoice.line_items : []
  // Toggled off then back on before the next regenerate/generation — the fee
  // is already sitting on this invoice, so there's nothing to add.
  if (lineItems.some((li) => li.fee_item_id === feeItemId)) return { applied: false }

  const amount = Number(feeItem.amount)
  const newLineItems = [
    ...lineItems,
    {
      name: feeItem.name,
      amount,
      kind: 'opt_in',
      fee_item_id: feeItemId,
      discountable: feeItem.is_discountable !== false,
    },
  ]

  const { data: student } = await supabase
    .from('students')
    .select('family_id')
    .eq('id', studentId)
    .single()

  const discountableSubtotal = newLineItems
    .filter((li) => li.kind !== 'previous_balance' && li.kind !== 'credit_applied' && li.discountable !== false)
    .reduce((s, li) => s + li.amount, 0)

  const discountSettings = await getDiscountSettingsFor(supabase, schoolId)
  const { discountAmount: newDiscountAmount, discountReason, appliedDiscounts } = await computeDiscountsForInvoice(
    supabase,
    schoolId,
    { id: studentId, family_id: student?.family_id ?? null },
    discountableSubtotal,
    discountSettings,
    invoice.id
  )

  const discountDelta = newDiscountAmount - Number(invoice.discount_amount || 0)
  const newTotal = Number(invoice.total_amount) + amount - discountDelta
  const paid = Number(invoice.paid_amount || 0)
  let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
  if (paid >= newTotal) newStatus = 'paid'
  else if (paid > 0) newStatus = 'partial'

  const { error } = await supabase
    .from('invoices')
    .update({
      line_items: newLineItems,
      subtotal: Number(invoice.subtotal) + amount,
      discount_amount: newDiscountAmount,
      discount_reason: discountReason,
      total_amount: newTotal,
      // NOTE: outstanding_amount is a GENERATED column (total_amount - paid_amount).
      // Writing it directly makes Postgres reject the ENTIRE update, which the
      // swallowed `if (error) return { applied: false }` below turned into a silent
      // no-op — the reason additive opt-in never actually applied. It recomputes
      // itself from the new total_amount, so it must NOT be set here.
      status: newStatus,
      // Only a genuine "update" if it was already sent — an invoice that
      // hasn't gone out yet has nothing to resend.
      needs_resend: !!invoice.sent_at,
    })
    .eq('id', invoice.id)
    .eq('school_id', schoolId)

  if (error) return { applied: false }

  await recordAppliedDiscounts(supabase, schoolId, studentId, invoice.id, appliedDiscounts)

  await logAuditEvent(supabase, {
    schoolId,
    actorId,
    action: 'invoice.fee_added',
    targetType: 'invoice',
    targetId: invoice.id,
    summary: `Added ${feeItem.name} (₦${amount.toLocaleString()}) to a live invoice via opt-in`,
    metadata: { studentId, feeItemId, feeItemName: feeItem.name, amount, discountDelta, invoiceSentAt: invoice.sent_at },
  })

  return { applied: true }
}

