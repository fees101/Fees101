// Tunable constants for Data & privacy. Kept in one place so the values that
// need a business/legal decision are easy to find and change.

// Published policy documents. The marketing site (fees101.com) predates much of
// the current product, so the CONTENT may need updating — but these URLs are
// expected to stay stable across that update. Adjust here if the paths differ.
export const PRIVACY_POLICY_URL = 'https://fees101.com/privacy'
export const TERMS_URL = 'https://fees101.com/terms'

// Where data-request / privacy enquiries should go.
export const PRIVACY_CONTACT_EMAIL = 'support@fees101.com'

// Deletion timeline.
// After an owner confirms account deletion, personal data is kept for this many
// days (cancellable) before the scheduled-deletion cron permanently removes it.
export const DELETION_GRACE_DAYS = 30

// Financial records (invoices/payments) are retained — anonymised, with no
// student or parent names — for this many years after closure, to satisfy tax /
// audit record-keeping (Nigerian FIRS record-keeping is 6 years), then purged.
export const FINANCIAL_RETENTION_YEARS = 6

// The exact consent text an owner must accept to close the account. Stored on
// the deletion request as evidence, and shown as the checkbox label — kept here
// (not in the 'use server' actions file, which may only export async functions)
// so both the action and the client dialog import the one source of truth.
export const DELETION_ACKNOWLEDGEMENT =
  "I've exported anything I need. I understand this permanently deletes my school's data after the grace period."

// Format a scheduled_for timestamp for user-facing copy, e.g. "26 September 2026".
// Kept here (pure, no server-only imports) so client components can use it too.
export function formatDeletionDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
