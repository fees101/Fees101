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
