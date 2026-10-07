// Flagged-payment review — the full scoped list behind the dashboard's
// "N payments flagged for review" Needs-you row. A modal doesn't scale once a
// larger school accumulates more than a handful of these, and a notification's
// body alone (amount + provider reference) doesn't let a school actually open
// the payment it's about — so this is a real paginated page, and each row
// links to the student/family it's about (student_id/family_id, added
// 2026-10-07 — see db/admin_notifications_student_link.sql).

import { getAuthContext } from '@/lib/auth/permissions'
import { FLAGGED_PAYMENT_NOTIFICATION_TYPES } from '@/lib/notifications/flaggedPaymentTypes'

export interface FlaggedPaymentRow {
  id: string
  type: string
  title: string
  body: string
  createdAt: string
  studentId: string | null
  studentName: string | null
  familyId: string | null
  familyName: string | null
  // The real paid amount, when known (rows created before this column existed
  // are null). Lets the list deep-link into the Record feed's exact-amount
  // search instead of only linking to the student's whole history.
  amount: number | null
}

export async function getFlaggedPaymentsPage(opts: {
  page: number
  perPage: number
}): Promise<{ rows: FlaggedPaymentRow[]; total: number } | { error: string }> {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated' }

  const from = (opts.page - 1) * opts.perPage
  const to = from + opts.perPage - 1

  const { data, count, error } = await ctx.supabase
    .from('admin_notifications')
    .select(
      `
      id, type, title, body, created_at, student_id, family_id, amount,
      students(first_name, last_name),
      families(primary_parent_name)
    `,
      { count: 'exact' },
    )
    .eq('school_id', ctx.schoolId)
    .is('read_at', null)
    .in('type', FLAGGED_PAYMENT_NOTIFICATION_TYPES as unknown as string[])
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) return { error: error.message }

  const rows: FlaggedPaymentRow[] = (data || []).map((n: any) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    createdAt: n.created_at,
    studentId: n.student_id,
    studentName: n.students ? `${n.students.first_name} ${n.students.last_name}`.trim() : null,
    familyId: n.family_id,
    familyName: n.families?.primary_parent_name || null,
    amount: n.amount === null || n.amount === undefined ? null : Number(n.amount),
  }))

  return { rows, total: count || 0 }
}
