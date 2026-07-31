'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { computeInvoiceForStudent, applyCreditBalanceDelta } from '@/lib/computeInvoice'
import { recordAppliedDiscounts } from '@/lib/discounts/compute'

async function getContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: userProfile } = await supabase.from('users').select('school_id, role').eq('id', user.id).single()
  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase.from('schools').select('id').limit(1).single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return null
  if (userProfile?.role !== 'school_admin' && userProfile?.role !== 'super_admin') return null
  return { supabase, schoolId, userId: user.id }
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
    .select('id, invoice_id, student_id, status')
    .eq('id', discountId)
    .eq('school_id', schoolId)
    .single()
  if (!discount) return { error: 'Discount request not found' }
  if (discount.status !== 'pending') return { error: 'This request has already been resolved' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, billing_cycle_id, paid_amount, total_amount, credit_applied, sent_at')
    .eq('id', discount.invoice_id)
    .eq('school_id', schoolId)
    .single()
  if (!invoice) return { error: 'Invoice not found' }
  if (Number(invoice.paid_amount || 0) > 0) {
    return { error: 'This invoice already has a payment against it, so this request can no longer be approved. Reject it instead.' }
  }

  const now = new Date().toISOString()
  const { error: approveError } = await supabase
    .from('discounts')
    .update({ status: 'applied', approved_by: userId, approved_at: now, applied_at: now })
    .eq('id', discountId)
  if (approveError) return { error: approveError.message }

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
      needs_resend: !!invoice.sent_at,
      updated_at: now,
    })
    .eq('id', invoice.id)
  if (updateError) return { error: updateError.message }

  await recordAppliedDiscounts(supabase, schoolId, discount.student_id, invoice.id, computed.appliedDiscounts)
  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, discount.student_id, -computed.creditApplied)
  }

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
    .select('id, invoice_id, status')
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
    .select('id, is_recurring, status')
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

  revalidatePath('/discounts')
  return { success: true }
}
