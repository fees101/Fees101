'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const CATEGORIES = ['staff_child', 'scholarship', 'bursary', 'financial_hardship', 'fee_waiver', 'other'] as const
export type ManualDiscountCategory = typeof CATEGORIES[number]

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
  return { supabase, schoolId, userId: user.id }
}

interface RequestDiscountInput {
  category: ManualDiscountCategory
  amount: number
  isPercentage: boolean
  isRecurring: boolean
  reason: string
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
  if (!(input.amount > 0)) return { error: 'Amount must be greater than 0' }
  if (input.isPercentage && input.amount > 100) return { error: 'Percentage discounts cannot exceed 100%' }

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, student_id, status, paid_amount')
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()
  if (!invoice) return { error: 'Invoice not found' }
  if (invoice.status === 'cancelled') return { error: 'This invoice is cancelled.' }
  if (Number(invoice.paid_amount || 0) > 0) {
    return { error: 'This invoice already has a payment against it, so discounts can no longer be applied to it.' }
  }

  const { error } = await supabase.from('discounts').insert({
    school_id: schoolId,
    invoice_id: invoiceId,
    student_id: invoice.student_id,
    amount: input.amount,
    is_percentage: input.isPercentage,
    is_recurring: input.isRecurring,
    category: input.category,
    reason: input.reason.trim(),
    status: 'pending',
    requested_by: userId,
  })
  if (error) return { error: error.message }

  revalidatePath(`/invoices/${invoiceId}`)
  return { success: true }
}
