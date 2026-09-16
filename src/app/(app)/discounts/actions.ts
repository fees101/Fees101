'use server'

import { revalidatePath } from 'next/cache'
import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'
import { requirePermission } from '@/lib/auth/permissions'
import { logAuditEvent } from '@/lib/audit/logAudit'

// Approving/rejecting/revoking discounts requires the approve-discounts
// permission (owner/super_admin/is_admin bypass inside requirePermission).
async function getContext() {
  const ctx = await requirePermission('approve-discounts')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

// Approving a discount immediately recomputes and persists the target
// invoice — there's no "next generation" to wait for, since the discount
// request was made against an already-generated invoice.
export async function approveDiscount(discountId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authorized' }
  const { supabase, schoolId, userId } = ctx

  const { data: discount } = await supabase
    .from('discounts')
    .select('id, invoice_id, student_id, category, amount, is_percentage, status')
    .eq('id', discountId)
    .eq('school_id', schoolId)
    .single()
  if (!discount) return { error: 'Discount request not found' }
  if (discount.status !== 'pending') return { error: 'This request has already been resolved' }

  const now = new Date().toISOString()

  // Claim the request atomically: the WHERE status='pending' is re-checked by
  // Postgres against the committed row, so two concurrent approve clicks (or
  // an approve racing a reject) can never both proceed — the loser's update
  // affects zero rows. Fixes the reproduced double-approval race
  // (2026-09-16: two discount.approved audit rows, 2s apart, one request).
  const { data: claimed, error: claimError } = await supabase
    .from('discounts')
    .update({ status: 'applied', approved_by: userId, approved_at: now, applied_at: now })
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
    // Fixes the approval-vs-payment race (2026-09-16 stress test) by turning
    // a silent simultaneously-discounted-and-overpaid invoice into an
    // explicit, retryable error instead.
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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'discount.approved',
    targetType: 'discount',
    targetId: discountId,
    summary: `Approved a ${discount.category || ''} discount on invoice ${invoice.id}`,
    metadata: {
      invoiceId: invoice.id,
      studentId: discount.student_id,
      category: discount.category,
      amount: discount.amount,
      isPercentage: discount.is_percentage,
      newInvoiceStatus: newStatus,
      discountAmountApplied: computed.discountAmount,
    },
  })

  revalidatePath('/discounts')
  revalidatePath(`/invoices/${invoice.id}`)
  revalidatePath(`/students/${discount.student_id}`)
  return { success: true }
}

export async function rejectDiscount(discountId: string, rejectionReason: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authorized' }
  const { supabase, schoolId, userId } = ctx

  if (!rejectionReason.trim()) return { error: 'A rejection reason is required' }

  const { data: discount } = await supabase
    .from('discounts')
    .select('id, invoice_id, student_id, status')
    .eq('id', discountId)
    .eq('school_id', schoolId)
    .single()
  if (!discount) return { error: 'Discount request not found' }
  if (discount.status !== 'pending') return { error: 'This request has already been resolved' }

  const { error } = await supabase
    .from('discounts')
    .update({
      status: 'rejected',
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: rejectionReason.trim(),
    })
    .eq('id', discountId)
  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'discount.rejected',
    targetType: 'discount',
    targetId: discountId,
    summary: `Rejected a discount request on invoice ${discount.invoice_id}`,
    metadata: { invoiceId: discount.invoice_id, studentId: discount.student_id, reason: rejectionReason.trim() },
  })

  revalidatePath('/discounts')
  revalidatePath(`/invoices/${discount.invoice_id}`)
  return { success: true }
}

// Stops a recurring discount (e.g. staff-child) from carrying forward to any
// future invoice — e.g. the staff member has left. This never touches
// invoices already generated with it applied; those keep their history.
// Only the next generation/regeneration stops picking it up, since
// getRecurringDiscounts() in src/lib/discounts/compute.ts only looks at rows
// still flagged is_recurring = true.
export async function revokeRecurringDiscount(discountId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authorized' }
  const { supabase, schoolId } = ctx

  const { data: discount } = await supabase
    .from('discounts')
    .select('id, invoice_id, student_id, is_recurring, status')
    .eq('id', discountId)
    .eq('school_id', schoolId)
    .single()
  if (!discount) return { error: 'Discount not found' }
  if (!discount.is_recurring) return { error: 'This discount is not recurring' }
  if (discount.status !== 'approved' && discount.status !== 'applied') return { error: 'This discount is not active' }

  const { error } = await supabase
    .from('discounts')
    .update({ is_recurring: false, updated_at: new Date().toISOString() })
    .eq('id', discountId)
  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: ctx.userId,
    action: 'discount.recurring_revoked',
    targetType: 'discount',
    targetId: discountId,
    summary: `Stopped a recurring discount from carrying forward`,
    metadata: { invoiceId: discount.invoice_id, studentId: discount.student_id },
  })

  revalidatePath('/discounts')
  return { success: true }
}
