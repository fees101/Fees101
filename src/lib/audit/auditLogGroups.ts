// Shared between the server page (for server-side filtering) and the client
// table (for the category dropdown) so the two never drift apart.
export const AUDIT_LOG_GROUPS: { label: string; prefixes: string[] }[] = [
  { label: 'Staff', prefixes: ['staff.'] },
  { label: 'Roles', prefixes: ['role.'] },
  { label: 'Discounts', prefixes: ['discount.'] },
  { label: 'Invoices', prefixes: ['invoice.'] },
  { label: 'Students', prefixes: ['student.'] },
  { label: 'Families', prefixes: ['family.'] },
  { label: 'Classes & sections', prefixes: ['class.', 'section.'] },
  { label: 'Sessions & terms', prefixes: ['session.', 'term.', 'year_end.'] },
  { label: 'Fee structure', prefixes: ['fee_item.', 'fee_group.'] },
  { label: 'Settings', prefixes: ['school.', 'payment_config.', 'discount_config.', 'reminder_config.', 'account.'] },
  { label: 'Reports', prefixes: ['report.'] },
]

// Resolve an action key (e.g. 'student.added') to its module label — used by the
// table to render a colour-coded module pill per row. Falls back to 'Other' for
// any action that doesn't match a known prefix.
export function groupForAction(action: string): string {
  return AUDIT_LOG_GROUPS.find((g) => g.prefixes.some((p) => action.startsWith(p)))?.label ?? 'Other'
}
