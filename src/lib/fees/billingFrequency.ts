// The 3-way billing frequency that replaces fee_items.is_recurring. It lets a
// school say exactly how often a fee bills, which is how Nigerian fees actually
// behave: tuition every term, a development levy or PTA due once a year on the
// first term, a one-off like a graduation gown this term only.
//
//   per_term        billed on every term's invoice          (old is_recurring = true)
//   once_a_session  billed once a year, on the session's first term; comes back
//                   on its own at the next year's rollover, never on a sibling term
//   this_term_only  billed once, never carries               (old is_recurring = false)
//
// Kept deliberately separate from discounts.is_recurring, which is an unrelated
// recurring-vs-one-off flag on the discounts table.

export type BillingFrequency = 'per_term' | 'once_a_session' | 'this_term_only'

export const BILLING_FREQUENCIES: BillingFrequency[] = [
  'per_term',
  'once_a_session',
  'this_term_only',
]

// Copy for the "WHEN" control in the add/edit fee drawer. Order matches the
// App Shell canvas: Every term, Once a session, This term only.
export const BILLING_FREQUENCY_OPTIONS: {
  value: BillingFrequency
  label: string
  hint: string
}[] = [
  {
    value: 'per_term',
    label: 'Every term',
    hint: 'On every term’s invoice.',
  },
  {
    value: 'once_a_session',
    label: 'Once a session',
    hint: 'Billed on the first term of the session. Comes back on its own next year.',
  },
  {
    value: 'this_term_only',
    label: 'This term only',
    hint: 'Billed once. Does not carry into the next term.',
  },
]

// Keep the legacy is_recurring boolean in sync while both columns exist: only a
// this-term-only fee is non-recurring. Anything that repeats (every term, or
// once a session) stays recurring to any reader still keying off the old flag.
export function isRecurringFromFrequency(f: BillingFrequency): boolean {
  return f !== 'this_term_only'
}

// Read a frequency off a fee_items row, falling back to the old boolean for any
// row written before billing_frequency existed.
export function frequencyFromRow(row: {
  billing_frequency?: string | null
  is_recurring?: boolean | null
}): BillingFrequency {
  if (
    row.billing_frequency === 'per_term' ||
    row.billing_frequency === 'once_a_session' ||
    row.billing_frequency === 'this_term_only'
  ) {
    return row.billing_frequency
  }
  return row.is_recurring === false ? 'this_term_only' : 'per_term'
}
