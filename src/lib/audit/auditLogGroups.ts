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
  { label: 'Payments', prefixes: ['payment.'] },
  { label: 'Settings', prefixes: ['school.', 'payment_config.', 'discount_config.', 'reminder_config.', 'account.'] },
  { label: 'Reports', prefixes: ['report.'] },
]
