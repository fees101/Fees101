import type { SupabaseClient } from '@supabase/supabase-js'
import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'
import { logAuditEvent } from '@/lib/audit/logAudit'

export type RevokeDiscountResult =
  | { error: string }
  | { success: true; fullyRemoved: boolean; studentId: string; invoiceId: string }

// Shared by the student page (ApplyDiscountButton) and the Discounts Queue's
// DECIDED history — both let staff revoke a discount that's currently active
// (approved or applied). While there's nothing yet to unwind (not sent, not
// paid), it's lifted off the invoice entirely and the invoice recomputes;
// once sent or paid, we only stop it carrying forward — an invoice already
// sent or paid keeps its history. Either way, revoked_at/revoked_by are
// stamped so "revoked" survives as a status distinct from "was never
// approved" (rejected) or "still active" (applied) wherever the discount is
// shown afterwards (see db/discounts_revoked.sql).
export async function revokeActiveDiscount(
  supabase: SupabaseClient,
  schoolId: string,
  userId: string,
  discountId: string,
): Promise<RevokeDiscountResult> {
  const { data: discount } = await supabase
    .from('discounts')
    .select('id, invoice_id, student_id, category, is_recurring, status')
    .eq('id', discountId)
    .eq('school_id', schoolId)
    .single()
  if (!discount) return { error: 'Discount not found' }
  if (discount.status !== 'approved' && discount.status !== 'applied') {
    return { error: 'This discount is not currently active' }
  }
  if (discount.category === 'sibling_discount') {
    return { error: 'Sibling discounts are auto-applied and cannot be revoked directly.' }
  }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, billing_cycle_id, paid_amount, credit_applied, sent_at, status')
    .eq('id', discount.invoice_id)
    .eq('school_id', schoolId)
    .single()
  if (!invoice) return { error: 'Invoice not found' }

  const canFullyRemove = !invoice.sent_at && Number(invoice.paid_amount || 0) === 0
  const now = new Date().toISOString()

  if (!canFullyRemove) {
    if (!discount.is_recurring) {
      return { error: 'This invoice has already been sent or paid against, so this one-off discount can no longer be removed.' }
    }

    // Sent/paid — only stop it carrying forward. This invoice's numbers
    // (already sent/paid against) are left untouched.
    const { error } = await supabase
      .from('discounts')
      .update({ is_recurring: false, revoked_at: now, revoked_by: userId, updated_at: now })
      .eq('id', discountId)
    if (error) return { error: error.message }

    await logAuditEvent(supabase, {
      schoolId,
      actorId: userId,
      action: 'discount.recurring_revoked',
      targetType: 'discount',
      targetId: discountId,
      summary: `Stopped a ${discount.category || ''} discount from carrying forward for student ${discount.student_id}`,
      metadata: { invoiceId: invoice.id, studentId: discount.student_id, category: discount.category, fullyRemoved: false },
    })

    return { success: true, fullyRemoved: false, studentId: discount.student_id, invoiceId: invoice.id }
  }

  // Nothing sent or paid yet — fully lift it off this invoice and recompute.
  const { error: rejectError } = await supabase
    .from('discounts')
    .update({
      status: 'rejected',
      rejected_by: userId,
      rejected_at: now,
      rejection_reason: 'Revoked before the invoice was sent',
      revoked_at: now,
      revoked_by: userId,
    })
    .eq('id', discountId)
  if (rejectError) return { error: rejectError.message }

  const previouslyApplied = Number(invoice.credit_applied || 0)
  if (previouslyApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, discount.student_id, previouslyApplied)
  }

  const paid = Number(invoice.paid_amount || 0)
  const computed = await computeInvoiceForStudent(
    supabase, schoolId, discount.student_id, invoice.billing_cycle_id, undefined, paid, invoice.id
  )
  if ('error' in computed) return { error: computed.error }

  let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
  if (paid >= computed.total) newStatus = 'paid'
  else if (paid > 0) newStatus = 'partial'

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      line_items: computed.lineItems,
      subtotal: computed.subtotal,
      discount_amount: computed.discountAmount,
      discount_reason: computed.discountReason || null,
      previous_balance: computed.previousBalance,
      previous_balance_from_invoice_id: computed.previousInvoiceId,
      credit_applied: computed.creditApplied,
      total_amount: computed.total,
      status: newStatus,
      updated_at: now,
    })
    .eq('id', invoice.id)
  if (updateError) return { error: updateError.message }

  await recordAppliedDiscounts(supabase, schoolId, discount.student_id, invoice.id, computed.appliedDiscounts)
  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, discount.student_id, -computed.creditApplied)
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'discount.recurring_revoked',
    targetType: 'discount',
    targetId: discountId,
    summary: `Revoked a ${discount.category || ''} discount and removed it from invoice ${invoice.id}`,
    metadata: { invoiceId: invoice.id, studentId: discount.student_id, category: discount.category, fullyRemoved: true },
  })

  return { success: true, fullyRemoved: true, studentId: discount.student_id, invoiceId: invoice.id }
}
