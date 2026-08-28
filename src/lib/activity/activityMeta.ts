// Shared metadata for the Recent Activity feed — labels, category grouping and
// per-event presentation. Kept free of any server imports so both the server
// query (src/lib/queries/activity.ts) and the client feed component can use it.

export type ActivityCategory =
  | 'payments'
  | 'invoices'
  | 'messages'
  | 'discounts'
  | 'students'

// The category filter chips, in display order. 'all' is the default.
export const ACTIVITY_CATEGORIES: { key: 'all' | ActivityCategory; label: string }[] = [
  { key: 'all', label: 'All activity' },
  { key: 'payments', label: 'Payments' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'messages', label: 'Messages' },
  { key: 'discounts', label: 'Discounts' },
  { key: 'students', label: 'Students' },
]

// Page sizes offered in the feed's pagination control. Shared by the server
// query (for validation) and the client component (for the dropdown).
export const ACTIVITY_PAGE_SIZE_OPTIONS = [50, 100, 200]

const CATEGORY_KEYS = new Set(ACTIVITY_CATEGORIES.map((c) => c.key))
export function isActivityCategory(v: string | undefined): v is 'all' | ActivityCategory {
  return !!v && CATEGORY_KEYS.has(v as 'all' | ActivityCategory)
}

// Human labels for each event_type coming out of the activity_feed view. The
// message rows carry the raw message_type (receipt, reminder_overdue, …); the
// rest are our own synthetic event names.
export const EVENT_TYPE_LABELS: Record<string, string> = {
  payment_received: 'Payment received',
  invoice_sent: 'Invoice sent',
  invoice_generated: 'Invoice generated',
  // message_logs.message_type values:
  invoice: 'Invoice sent to parent',
  invoice_short: 'Invoice sent to parent',
  invoice_full: 'Invoice sent to parent',
  receipt: 'Receipt sent',
  reminder_advance: 'Advance reminder sent',
  reminder_due: 'Due reminder sent',
  reminder_overdue: 'Overdue reminder sent',
  extras_prompt: 'Extras prompt sent',
  extras_confirmation: 'Extras confirmation sent',
  parent_query_response: 'Reply sent to parent',
  manual: 'Message sent',
  discount_requested: 'Discount requested',
  discount_approved: 'Discount approved',
  discount_rejected: 'Discount rejected',
  discount_applied: 'Discount applied',
  student_added: 'Student added',
}

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] || eventType
}
