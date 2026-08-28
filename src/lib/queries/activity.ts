import { getAuthContext } from '@/lib/auth/permissions'
import {
  isActivityCategory,
  eventTypeLabel,
  ACTIVITY_PAGE_SIZE_OPTIONS,
  type ActivityCategory,
} from '@/lib/activity/activityMeta'

// A single, presentation-ready row for the Recent Activity feed. Titles and
// subtitles are composed here (server-side) from the activity_feed view so the
// UI renders only human-readable values — names, class, parent, receipt/invoice
// references — and never a raw DB id.
export interface ActivityRow {
  id: string
  category: ActivityCategory
  eventType: string
  occurredAt: string
  title: string
  subtitle: string
  amount: number | null
  studentName: string | null
}

// Raw shape as it comes back from the activity_feed view.
interface FeedRow {
  event_id: string
  category: ActivityCategory
  event_type: string
  occurred_at: string
  student_id: string | null
  student_name: string | null
  class_name: string | null
  parent_name: string | null
  amount: string | number | null
  reference: string | null
  channel: string | null
  status: string | null
  actor_name: string | null
}

export interface ActivityFilters {
  category?: string
  from?: string // YYYY-MM-DD (inclusive)
  to?: string   // YYYY-MM-DD (inclusive)
  search?: string // student name
  page?: number
  perPage?: number
}

function describe(row: FeedRow): { title: string; subtitle: string } {
  const student = row.student_name || 'a student'
  const cls = row.class_name ? ` (${row.class_name})` : ''
  const parent = row.parent_name || 'the family'
  const ref = row.reference || ''

  switch (row.event_type) {
    case 'payment_received':
      return {
        title: 'Payment received',
        subtitle:
          `From ${parent} for ${student}${cls}` +
          (ref ? ` · Receipt #${ref}` : '') +
          (row.actor_name ? ` · Recorded by ${row.actor_name}` : ' · Automatic'),
      }
    case 'invoice_sent':
      return {
        title: 'Invoice sent',
        subtitle: `${ref ? `Invoice #${ref} ` : ''}to ${parent} for ${student}${cls}`,
      }
    case 'invoice_generated':
      return {
        title: 'Invoice generated',
        subtitle: `${ref ? `Invoice #${ref} ` : ''}for ${student}${cls}`,
      }
    case 'discount_requested':
    case 'discount_approved':
    case 'discount_rejected':
    case 'discount_applied':
      return {
        title: eventTypeLabel(row.event_type),
        subtitle: `For ${student}${cls}` + (row.actor_name ? ` · by ${row.actor_name}` : ''),
      }
    case 'student_added':
      return {
        title: 'Student added',
        subtitle: `${student}${cls}` + (ref ? ` · Adm #${ref}` : ''),
      }
    default: {
      // message_logs rows — receipts, reminders, invoice deliveries, manual.
      const channel = row.channel ? ` · ${row.channel.toUpperCase()}` : ''
      const failed = row.status === 'failed' ? ' · Failed' : ''
      return {
        title: eventTypeLabel(row.event_type),
        subtitle: `To ${parent} for ${student}${cls}${channel}${failed}`,
      }
    }
  }
}

export async function getActivityFeed(
  filters: ActivityFilters,
): Promise<{ rows: ActivityRow[]; total: number; page: number; perPage: number }> {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx

  const perPage = ACTIVITY_PAGE_SIZE_OPTIONS.includes(filters.perPage ?? 0)
    ? (filters.perPage as number)
    : 50
  const page = Math.max(1, filters.page ?? 1)

  if (!schoolId) return { rows: [], total: 0, page, perPage }

  const start = (page - 1) * perPage
  const end = start + perPage - 1

  // The view is RLS-scoped (security_invoker), but we filter school_id explicitly
  // too — matches the convention used across every other query in the app.
  let query = supabase
    .from('activity_feed')
    .select('*', { count: 'exact' })
    .eq('school_id', schoolId)

  if (isActivityCategory(filters.category) && filters.category !== 'all') {
    query = query.eq('category', filters.category)
  }
  if (filters.from) query = query.gte('occurred_at', `${filters.from}T00:00:00`)
  if (filters.to) query = query.lte('occurred_at', `${filters.to}T23:59:59.999`)
  if (filters.search?.trim()) {
    query = query.ilike('student_name', `%${filters.search.trim()}%`)
  }

  const { data, count, error } = await query
    .order('occurred_at', { ascending: false })
    .range(start, end)

  if (error) throw new Error(`Failed to load activity feed: ${error.message}`)

  const rows: ActivityRow[] = ((data as FeedRow[]) || []).map((r) => {
    const { title, subtitle } = describe(r)
    // Discount amounts can be a percentage (is_percentage) rather than naira, so
    // we don't surface them as currency here — the subtitle names the event and
    // student without risking a wrong ₦ figure. Everything else is real naira.
    const amount =
      r.category === 'discounts' || r.amount == null ? null : Number(r.amount)
    return {
      id: r.event_id,
      category: r.category,
      eventType: r.event_type,
      occurredAt: r.occurred_at,
      title,
      subtitle,
      amount,
      studentName: r.student_name,
    }
  })

  return { rows, total: count ?? 0, page, perPage }
}
