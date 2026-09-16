// Additive-only delta engine: appends a single opted-in fee to a student's
// current-cycle invoice, if one already exists. Deliberately narrow — it only
// ever appends a new line and increases the total, never re-derives or
// touches any existing line (previous_balance and previously-applied credit
// are left exactly as they are). That's what makes it safe to run regardless
// of sent_at/paid_amount: there's no refund/clawback risk on an addition, so
// unlike a full regenerate it needs no sent/paid gate at all.
//
// Discount is one exception: it IS recomputed, because a discountable fee
// added to a student with an active sibling/staff percentage discount must
// get its share of that discount too, same as it would if the whole invoice
// were regenerated — otherwise the new item would silently bill at full
// price. Recomputing can only ever increase discount_amount (same rates,
// larger discountable base), so it can only reduce what's newly owed — never
// claws back anything the parent already paid.
//
// Credit balance is the other: any of the student's live credit_balance not
// already spent on this invoice can now also cover part of the newly added
// fee, same as it would on a fresh generation — otherwise that credit sits
// unused while the invoice's outstanding balance grows for no reason.
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
    .select('id, line_items, subtotal, discount_amount, total_amount, paid_amount, outstanding_amount, sent_at, previous_balance, previous_balance_from_invoice_id, credit_applied')
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
    .select('family_id, credit_balance')
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
  const totalBeforeCredit = Number(invoice.total_amount) + amount - discountDelta
  const paid = Number(invoice.paid_amount || 0)

  // The invoice's own credit_applied already reflects whatever credit was
  // spent at generation time — untouched here. What can change is whether
  // the student's remaining live balance (credit never fully used up before,
  // or added since) now also covers part of this newly added fee.
  const previouslyApplied = Number(invoice.credit_applied || 0)
  const liveCreditBalance = Number(student?.credit_balance || 0)
  const stillUnpaid = Math.max(0, totalBeforeCredit - paid)
  const additionalCreditApplied = Math.min(liveCreditBalance, stillUnpaid)
  const newCreditApplied = previouslyApplied + additionalCreditApplied
  const newTotal = totalBeforeCredit - additionalCreditApplied

  const finalLineItems = newLineItems.filter((li) => li.kind !== 'credit_applied')
  if (newCreditApplied > 0) {
    finalLineItems.push({ name: 'Credit balance applied', amount: -newCreditApplied, kind: 'credit_applied' })
  }

  let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
  if (paid >= newTotal) newStatus = 'paid'
  else if (paid > 0) newStatus = 'partial'

  // Invoice update and credit_balance spend must land together — the same
  // apply_invoice_recompute RPC full regeneration uses, not separate
  // .update() calls (a crash between them would silently over/under-credit
  // the student).
  const { error } = await supabase.rpc('apply_invoice_recompute', {
    p_invoice_id: invoice.id,
    p_school_id: schoolId,
    p_student_id: studentId,
    p_line_items: finalLineItems,
    p_subtotal: Number(invoice.subtotal) + amount,
    p_discount_amount: newDiscountAmount,
    p_discount_reason: discountReason || null,
    p_previous_balance: Number(invoice.previous_balance || 0),
    p_previous_balance_from_invoice_id: invoice.previous_balance_from_invoice_id || null,
    p_credit_applied: newCreditApplied,
    p_total_amount: newTotal,
    p_status: newStatus,
    // Only a genuine "update" if it was already sent — an invoice that
    // hasn't gone out yet has nothing to resend.
    p_needs_resend: !!invoice.sent_at,
    p_credit_delta: previouslyApplied - newCreditApplied,
  })

  if (error) return { applied: false }

  await recordAppliedDiscounts(supabase, schoolId, studentId, invoice.id, appliedDiscounts)

  await logAuditEvent(supabase, {
    schoolId,
    actorId,
    action: 'invoice.fee_added',
    targetType: 'invoice',
    targetId: invoice.id,
    summary: `Added ${feeItem.name} (₦${amount.toLocaleString()}) to a live invoice via opt-in`,
    metadata: { studentId, feeItemId, feeItemName: feeItem.name, amount, discountDelta, additionalCreditApplied, invoiceSentAt: invoice.sent_at },
  })

  return { applied: true }
}

