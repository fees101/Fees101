'use server'

import { getAuthContext, can } from '@/lib/auth/permissions'
import { getActivityForExport, type ActivityFilters } from '@/lib/queries/activity'

// Wrap a CSV cell: quote it and double any embedded quotes so commas, quotes
// and newlines in names or descriptions can't break the columns.
function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Build the Record archive as CSV for the current range/category/search. Mirrors
// what the table shows (Time, Who, Event, Amount, Category) plus the full detail
// line, so an exported row carries everything the on-screen row does.
export async function exportActivityCsv(
  filters: ActivityFilters,
): Promise<{ csv: string } | { error: string }> {
  const ctx = await getAuthContext()
  if (!ctx) return { error: 'Not authenticated' }
  if (!can(ctx, 'see-activity')) return { error: 'Not authorized' }
  const showFinancials = can(ctx, 'see-financial-totals')

  const rows = await getActivityForExport(filters, showFinancials)

  const header = ['Time', 'Who', 'Event', 'Detail', 'Amount', 'Category']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        csvCell(new Date(r.occurredAt).toISOString()),
        csvCell(r.who),
        csvCell(r.title),
        csvCell(r.subtitle),
        csvCell(r.amount),
        csvCell(r.category),
      ].join(','),
    )
  }

  return { csv: lines.join('\n') }
}
