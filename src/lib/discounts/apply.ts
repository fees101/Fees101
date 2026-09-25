import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'

export type ClaimAndApplyResult =
  | { error: string }
  | {
      success: true
      invoiceId: string
      studentId: string
      newInvoiceStatus: 'pending' | 'partial' | 'paid'
      discountAmountApplied: number
    }

// Shared by manual approval (discounts/actions.ts's approveDiscount) and
// threshold-based auto-approval (invoices/[id]/discountActions.ts's
// requestDiscount) — claims a pending discount atomically, recomputes the
// target invoice, and persists both. `approvedBy` is null for an
// auto-approval (no human clicked approve) and the acting user's id for a
// manual one; either way the row ends up `status: 'applied'`.
export async function claimAndApplyDiscount(
  supabase: any,
  schoolId: string,
  discountId: string,
  approvedBy: string | null
): Promise<ClaimAndApplyResult> {
  const { data: discount } = await supabase
    .from('discounts')
    .select('id, invoice_id, student_id, status')
    .eq('id', discountId)
    .eq('school_id', schoolId)
    .single()
  if (!discount) return { error: 'Discount request not found' }
  if (discount.status !== 'pending') return { error: 'This request has already been resolved' }

  const now = new Date().toISOString()

  // Claim the request atomically: the WHERE status='pending' is re-checked by
  // Postgres against the committed row, so two concurrent claims (a manual
  // approve racing this same auto-approve path, or two manual clicks) can
  // never both proceed — the loser's update affects zero rows.
  const { data: claimed, error: claimError } = await supabase
    .from('discounts')
    .update({ status: 'applied', approved_by: approvedBy, approved_at: now, applied_at: now })
    .eq('id', discountId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (claimError) return { error: claimError.message }
  if (!claimed) return { error: 'This request has already been resolved' }

  // Re-read the invoice only after claiming the discount, so paid_amount is
  // as fresh as possible going into the compute step below.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, billing_cycle_id, paid_amount, total_amount, credit_applied, sent_at')
    .eq('id', discount.invoice_id)
    .eq('school_id', schoolId)
    .single()
  if (!invoice) return { error: 'Invoice not found' }
  if (Number(invoice.paid_amount || 0) > 0) {
    // Undo the claim — this request is still genuinely pending, just not
    // approvable right now.
    await supabase.from('discounts').update({ status: 'pending', approved_by: null, approved_at: null, applied_at: null }).eq('id', discountId)
    return { error: 'This invoice already has a payment against it, so this request can no longer be approved. Reject it instead.' }
  }

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

  const { error: updateError, data: updatedInvoice } = await supabase
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
      needs_resend: !!invoice.sent_at,
      updated_at: now,
    })
    // Optimistic-concurrency guard: if a payment landed on this invoice
    // between our read of paid_amount above and this write, paid_amount will
    // have moved and this predicate won't match — Postgres re-checks WHERE
    // against the committed row, so the two can never both silently succeed.
    .eq('id', invoice.id)
    .eq('paid_amount', invoice.paid_amount)
    .select('id')
    .maybeSingle()
  if (updateError) return { error: updateError.message }
  if (!updatedInvoice) {
    // Best-effort rollback of the two mutations already made above, then
    // surface the conflict rather than leaving a half-applied discount.
    if (previouslyApplied > 0) {
      await applyCreditBalanceDelta(supabase, schoolId, discount.student_id, -previouslyApplied)
    }
    await supabase.from('discounts').update({ status: 'pending', approved_by: null, approved_at: null, applied_at: null }).eq('id', discountId)
    return { error: 'A payment was just recorded on this invoice, so the discount could not be safely applied. Please try approving again.' }
  }

  await recordAppliedDiscounts(supabase, schoolId, discount.student_id, invoice.id, computed.appliedDiscounts)
  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, discount.student_id, -computed.creditApplied)
  }

  return {
    success: true,
    invoiceId: invoice.id,
    studentId: discount.student_id,
    newInvoiceStatus: newStatus,
    discountAmountApplied: computed.discountAmount,
  }
}
