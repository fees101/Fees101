'use server'

import { revalidatePath } from 'next/cache'
import { revokeActiveDiscount } from '@/lib/discounts/revoke'
import { claimAndApplyDiscount } from '@/lib/discounts/apply'
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

  // Fetched only for the audit summary below — claimAndApplyDiscount does
  // its own authoritative status check/claim.
  const { data: discount } = await supabase
    .from('discounts')
    .select('id, invoice_id, student_id, category, amount, is_percentage')
    .eq('id', discountId)
    .eq('school_id', schoolId)
    .single()
  if (!discount) return { error: 'Discount request not found' }

  // Fixes the reproduced double-approval race (2026-09-16: two
  // discount.approved audit rows, 2s apart, one request) and the
  // approval-vs-payment race (2026-09-16 stress test) — both handled inside
  // the shared claim/compute/write helper via atomic claim + optimistic
  // concurrency, now also reused by threshold-based auto-approval.
  const result = await claimAndApplyDiscount(supabase, schoolId, discountId, userId)
  if ('error' in result) return result

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'discount.approved',
    targetType: 'discount',
    targetId: discountId,
    summary: `Approved a ${discount.category || ''} discount on invoice ${result.invoiceId}`,
    metadata: {
      invoiceId: result.invoiceId,
      studentId: discount.student_id,
      category: discount.category,
      amount: discount.amount,
      isPercentage: discount.is_percentage,
      newInvoiceStatus: result.newInvoiceStatus,
      discountAmountApplied: result.discountAmountApplied,
    },
  })

  revalidatePath('/discounts')
  revalidatePath(`/money/invoices/${result.invoiceId}`)
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
  revalidatePath(`/money/invoices/${discount.invoice_id}`)
  return { success: true }
}

// Revokes a discount that was previously approved — shown in the Queue's
// DECIDED history beside an "APPROVED" row so a decision that no longer
// applies (e.g. the staff member left, the scholarship ended) can be pulled
// without going to the student's own profile page. Business logic (fully
// remove vs. only stop carrying forward, and stamping revoked_at/revoked_by)
// is shared with ApplyDiscountButton's own revoke via revokeActiveDiscount,
// so a discount revoked from either place shows identically afterwards.
export async function revokeDecidedDiscount(discountId: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authorized' }
  const { supabase, schoolId, userId } = ctx

  const result = await revokeActiveDiscount(supabase, schoolId, userId, discountId)
  if ('error' in result) return result

  revalidatePath('/discounts')
  revalidatePath(`/money/invoices/${result.invoiceId}`)
  revalidatePath(`/students/${result.studentId}`)
  return result
}
