import { createClient } from '@/lib/supabase/server'

export interface PendingDiscountRequest {
  id: string
  invoiceId: string
  studentId: string
  studentName: string
  className: string
  cycleName: string
  category: string
  amount: number
  isPercentage: boolean
  isRecurring: boolean
  reason: string
  requestedByName: string | null
  requestedAt: string
}

async function getSchoolContext() {
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
  return { supabase, schoolId, role: userProfile?.role }
}

export interface ActiveRecurringDiscount {
  id: string
  studentId: string
  studentName: string
  className: string
  category: string
  amount: number
  isPercentage: boolean
  approvedAt: string | null
}

export async function getPendingDiscountRequests(): Promise<PendingDiscountRequest[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

  const { data } = await supabase
    .from('discounts')
    .select(`
      id, invoice_id, student_id, category, amount, is_percentage, is_recurring, reason, requested_at,
      students!inner(first_name, last_name, classes(name)),
      invoices!inner(billing_cycles(name)),
      requested_by_user:users!discounts_requested_by_fkey(name)
    `)
    .eq('school_id', schoolId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })

  return (data || []).map((row: any) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    studentId: row.student_id,
    studentName: `${row.students?.first_name || ''} ${row.students?.last_name || ''}`.trim(),
    className: row.students?.classes?.name || '',
    cycleName: row.invoices?.billing_cycles?.name || '',
    category: row.category,
    amount: Number(row.amount),
    isPercentage: row.is_percentage,
    isRecurring: row.is_recurring,
    reason: row.reason,
    requestedByName: row.requested_by_user?.name || null,
    requestedAt: row.requested_at,
  }))
}

// Recurring discounts (e.g. staff-child) that are still carrying forward
// automatically to each new invoice — this is the "who's currently getting
// one" list an admin needs in order to revoke one (e.g. staff member leaves).
// One row shown per student+category (the most recently approved), mirroring
// how src/lib/discounts/compute.ts:getRecurringDiscounts picks which row wins
// at generation time.
export async function getActiveRecurringDiscounts(): Promise<ActiveRecurringDiscount[]> {
  const ctx = await getSchoolContext()
  if (!ctx) return []
  const { supabase, schoolId } = ctx

  const { data } = await supabase
    .from('discounts')
    .select(`
      id, student_id, category, amount, is_percentage, approved_at, created_at,
      students!inner(first_name, last_name, classes(name))
    `)
    .eq('school_id', schoolId)
    .eq('is_recurring', true)
    .in('status', ['approved', 'applied'])
    .order('created_at', { ascending: false })

  const seen = new Set<string>()
  const latestPerStudentCategory: any[] = []
  for (const row of data || []) {
    const key = `${row.student_id}:${row.category}`
    if (seen.has(key)) continue
    seen.add(key)
    latestPerStudentCategory.push(row)
  }

  return latestPerStudentCategory.map((row: any) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: `${row.students?.first_name || ''} ${row.students?.last_name || ''}`.trim(),
    className: row.students?.classes?.name || '',
    category: row.category,
    amount: Number(row.amount),
    isPercentage: row.is_percentage,
    approvedAt: row.approved_at,
  }))
}

