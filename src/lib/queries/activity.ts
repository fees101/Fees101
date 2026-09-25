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
  // Where clicking this row should go — an invoice's own page for invoice
  // events, otherwise the student it belongs to (fees tab, where payments and
  // discounts actually show up). Null when there's no sensible destination
  // (e.g. a message with no related student).
  linkHref: string | null
  // The "WHO" column: the single person/agent the event is about — the student
  // for money and message events, the acting staff member or the family for the
  // rest, and "System" for automated events with no human.
  who: string
}

// Range-wide totals for the Record hero and count chips. Respect the date and
// search filters but ignore the active category (so the chips can each show
// their own count and the hero shows the whole range).
export interface ActivityAggregate {
  receivedInRange: number // sum of payment_received amounts in range
  totalEvents: number     // all events in range (any category)
  paymentsCount: number   // events in the payments category
  categoryCounts: Record<'all' | ActivityCategory, number>
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
  search?: string // free text: student, parent, staff, or an exact amount
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
    case 'invoice_cancelled':
      return {
        title: 'Invoice cancelled',
        subtitle:
          `${ref ? `Invoice #${ref} ` : ''}for ${student}${cls}` +
          (row.actor_name ? ` · by ${row.actor_name}` : ''),
      }
    case 'student_status_changed':
      return {
        title: 'Student status changed',
        subtitle:
          `${student}${cls} · ${row.reference || 'unknown'} → ${row.status || 'unknown'}` +
          (row.actor_name ? ` · by ${row.actor_name}` : ''),
      }
    case 'credit_balance_adjusted':
      return {
        title: 'Credit balance adjusted',
        subtitle:
          `Credited to ${student}${cls}'s balance` +
          (row.actor_name ? ` · by ${row.actor_name}` : ''),
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

// The WHO column value — the student for the money/message events that name one,
// otherwise the acting staff member or family, and "System" for automated rows.
function whoFor(row: FeedRow): string {
  return row.student_name || row.actor_name || row.parent_name || 'System'
}

function mapFeedRow(r: FeedRow, showFinancials: boolean): ActivityRow {
  const { title, subtitle } = describe(r)
  // Discount amounts can be a percentage (is_percentage) rather than naira, so
  // we don't surface them as currency here — the subtitle names the event and
  // student without risking a wrong ₦ figure. Everything else is real naira,
  // and without see-financial-totals it redacts to null the same way — the
  // event itself (title/subtitle) still shows, only the amount column blanks
  // to "—" (ActivityFeed already renders null as "—").
  const amount = r.category === 'discounts' || r.amount == null || !showFinancials ? null : Number(r.amount)
  return {
    id: r.event_id,
    category: r.category,
    eventType: r.event_type,
    occurredAt: r.occurred_at,
    title,
    subtitle,
    amount,
    studentName: r.student_name,
    linkHref: linkFor(r),
    who: whoFor(r),
  }
}

// event_id is `<row uuid>:<event_type>` (see activity_feed_view.sql) — the
// uuid before the colon is the invoice/payment/discount/student's own id.
// event_type values never contain a colon, so splitting on the first one is safe.
function rawId(eventId: string): string {
  return eventId.slice(0, eventId.indexOf(':'))
}

// An invoice event goes to that invoice; everything else that's about a
// student (payments, discounts, messages, new-student) goes to their fees
// tab, where payments and discounts actually surface. No student on the row
// (shouldn't happen outside invoices, but the view allows it) means no link.
function linkFor(r: FeedRow): string | null {
  if (r.category === 'invoices') return `/money/invoices/${rawId(r.event_id)}`
  if (!r.student_id) return null
  return `/students/${r.student_id}?tab=fees`
}

// Broaden the free-text search to everything the input placeholder promises —
// student, parent (family), acting staff, and an exact amount when the term is
// a number — so the copy is honest rather than filtering only student names.
// The term is stripped of PostgREST or() structural characters (comma, parens,
// quotes, backslash) first so a name like "Bello, Jr" or "O'Brien (Snr)" can't
// break out of the filter. Amount is matched exactly (an ilike on a numeric
// column isn't possible), and a naira sign or thousands commas the user types
// are tolerated. If nothing usable survives, the query is returned unfiltered.
function applySearch<T>(q: T, search: string | undefined): T {
  const raw = search?.trim()
  if (!raw) return q

  const clauses: string[] = []
  const text = raw.replace(/[,()"\\]/g, ' ').trim()
  if (text) {
    clauses.push(
      `student_name.ilike.%${text}%`,
      `parent_name.ilike.%${text}%`,
      `actor_name.ilike.%${text}%`,
    )
  }
  const numeric = raw.replace(/[₦,\s]/g, '')
  if (/^\d+(\.\d+)?$/.test(numeric)) clauses.push(`amount.eq.${numeric}`)

  if (clauses.length === 0) return q
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).or(clauses.join(',')) as T
}

// Apply the range/search filters shared by the feed page, the count chips and
// the hero total. Deliberately excludes the category filter so aggregates can
// span every category while the page rows stay scoped to the active chip.
export async function getActivityFeed(
  filters: ActivityFilters,
  showFinancials: boolean = false,
): Promise<{ rows: ActivityRow[]; total: number; page: number; perPage: number; aggregate: ActivityAggregate }> {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx

  const perPage = ACTIVITY_PAGE_SIZE_OPTIONS.includes(filters.perPage ?? 0)
    ? (filters.perPage as number)
    : 50
  const page = Math.max(1, filters.page ?? 1)

  const emptyAggregate: ActivityAggregate = {
    receivedInRange: 0,
    totalEvents: 0,
    paymentsCount: 0,
    categoryCounts: { all: 0, payments: 0, invoices: 0, messages: 0, discounts: 0, students: 0 },
  }
  if (!schoolId) return { rows: [], total: 0, page, perPage, aggregate: emptyAggregate }

  const start = (page - 1) * perPage
  const end = start + perPage - 1

  // Base filter shared by every query below (school + date range + free-text
  // search across student/parent/staff/amount), but NOT the category — the chips
  // each need their own range-wide count.
  const applyBase = <T>(q: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let out = (q as any).eq('school_id', schoolId)
    if (filters.from) out = out.gte('occurred_at', `${filters.from}T00:00:00`)
    if (filters.to) out = out.lte('occurred_at', `${filters.to}T23:59:59.999`)
    out = applySearch(out, filters.search)
    return out as T
  }

  // The page of rows for the active category.
  let pageQuery = applyBase(supabase.from('activity_feed').select('*', { count: 'exact' }))
  if (isActivityCategory(filters.category) && filters.category !== 'all') {
    pageQuery = pageQuery.eq('category', filters.category)
  }

  const CATS: ActivityCategory[] = ['payments', 'invoices', 'messages', 'discounts', 'students']

  const [pageRes, allCount, catCounts, receivedRes] = await Promise.all([
    pageQuery.order('occurred_at', { ascending: false }).range(start, end),
    applyBase(supabase.from('activity_feed').select('event_id', { count: 'exact', head: true })).then((r) => r.count ?? 0),
    Promise.all(
      CATS.map((c) =>
        applyBase(supabase.from('activity_feed').select('event_id', { count: 'exact', head: true }))
          .eq('category', c)
          .then((r) => r.count ?? 0),
      ),
    ),
    applyBase(supabase.from('activity_feed').select('amount')).eq('event_type', 'payment_received'),
  ])

  if (pageRes.error) throw new Error(`Failed to load activity feed: ${pageRes.error.message}`)

  const rows: ActivityRow[] = ((pageRes.data as FeedRow[]) || []).map(r => mapFeedRow(r, showFinancials))

  // Zeroed server-side (not just masked on render) — ActivityFeed is a client
  // component, so this aggregate becomes part of its props/RSC payload.
  const receivedInRange = !showFinancials ? 0 : ((receivedRes.data as { amount: string | number | null }[]) || []).reduce(
    (sum, r) => sum + Number(r.amount || 0),
    0,
  )

  const categoryCounts = {
    all: allCount,
    payments: catCounts[0],
    invoices: catCounts[1],
    messages: catCounts[2],
    discounts: catCounts[3],
    students: catCounts[4],
  }

  const aggregate: ActivityAggregate = {
    receivedInRange,
    totalEvents: allCount,
    paymentsCount: catCounts[0],
    categoryCounts,
  }

  return { rows, total: pageRes.count ?? 0, page, perPage, aggregate }
}

// All rows in the current range/category (no pagination) for CSV export. Capped
// so a full-history export can't run away — the hero already tells the user how
// many events are in range before they click.
const EXPORT_ROW_CAP = 10000
export async function getActivityForExport(filters: ActivityFilters, showFinancials: boolean = false): Promise<ActivityRow[]> {
  const ctx = await getAuthContext()
  if (!ctx) throw new Error('Not authenticated')
  const { supabase, schoolId } = ctx
  if (!schoolId) return []

  let query = supabase.from('activity_feed').select('*').eq('school_id', schoolId)
  if (isActivityCategory(filters.category) && filters.category !== 'all') {
    query = query.eq('category', filters.category)
  }
  if (filters.from) query = query.gte('occurred_at', `${filters.from}T00:00:00`)
  if (filters.to) query = query.lte('occurred_at', `${filters.to}T23:59:59.999`)
  query = applySearch(query, filters.search)

  const { data, error } = await query.order('occurred_at', { ascending: false }).range(0, EXPORT_ROW_CAP - 1)
  if (error) throw new Error(`Failed to export activity: ${error.message}`)
  return ((data as FeedRow[]) || []).map(r => mapFeedRow(r, showFinancials))
}
