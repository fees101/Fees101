// ---------------------------------------------------------------------------
// The permission catalog — the single, fixed universe of capability switches a
// school can toggle on each of its custom roles. This is the source of truth
// for: the seed defaults (db/roles_permissions.sql), the toggle-matrix UI
// (RolesEditor), the report gating, and the can() checks throughout the app.
//
// Two kinds:
//   SEE — visibility. Hides/shows data (KPI totals, analytics, reports…).
//   DO  — actions.     Allows/blocks a mutation (add students, approve…).
//
// Owner (school_admin), Fees101 staff (super_admin) and any is_admin role
// bypass every switch — see has_permission() / getAuthContext().
// ---------------------------------------------------------------------------

export type PermissionGroup = 'SEE' | 'DO'

export interface PermissionDef {
  key: string
  group: PermissionGroup
  label: string
  description: string
}

export const PERMISSIONS: PermissionDef[] = [
  // --- SEE (visibility) ---
  { key: 'see-financial-totals', group: 'SEE', label: 'See financial totals',
    description: 'Money KPI cards on the dashboard & fees overview, collection charts, and money columns in report downloads and analytics.' },
  { key: 'see-analytics', group: 'SEE', label: 'See analytics',
    description: 'The Payments analytics page — timelines, comparisons, rates. (Independent of financial totals — trend/rate visuals show regardless; dollar figures still require "See financial totals".)' },
  { key: 'see-reports', group: 'SEE', label: 'See & download reports',
    description: 'The Reports page and CSV exports. (Totals-bearing reports also require "See financial totals".)' },
  { key: 'see-students', group: 'SEE', label: 'See students',
    description: 'The student directory and student profiles.' },
  { key: 'see-discounts', group: 'SEE', label: 'See discounts',
    description: 'The discount requests page and active recurring discounts.' },
  { key: 'see-fee-structure', group: 'SEE', label: 'See fee structure & cycles',
    description: 'View fee items/groups, sessions, terms and billing cycles (without being able to edit them).' },
  { key: 'see-invoices', group: 'SEE', label: 'See invoices',
    description: 'View the invoice list and invoice detail pages (without being able to generate or send them).' },

  // --- DO (actions) ---
  { key: 'manage-students', group: 'DO', label: 'Add, edit & import students',
    description: 'Create and edit students & families, change status, bulk-import from CSV, toggle fee opt-ins, set exemptions, provision payment accounts, and send ad-hoc reminders.' },
  { key: 'manage-fee-structure', group: 'DO', label: 'Manage fee structure, sessions & cycles',
    description: 'Set fees per class, manage fee groups, create sessions and terms, and manage billing cycles.' },
  { key: 'manage-invoices', group: 'DO', label: 'Generate & send invoices',
    description: 'Generate and regenerate a term’s invoices, and send or resend them to families.' },
  { key: 'request-discounts', group: 'DO', label: 'Request discounts',
    description: 'Raise staff/sibling/scholarship discount requests for approval.' },
  { key: 'approve-discounts', group: 'DO', label: 'Approve discounts',
    description: 'Approve or reject discount requests, and revoke recurring discounts.' },
  { key: 'run-year-end', group: 'DO', label: 'Run year-end rollover',
    description: 'View and run the year-end rollover: close the year, promote students, and open the new session.' },
  { key: 'manage-school-profile', group: 'DO', label: 'Manage school profile',
    description: 'Edit the school name, logo, and contact details.' },
  { key: 'manage-academic-structure', group: 'DO', label: 'Manage classes & sections',
    description: 'Add, edit and reorder classes and academic sections.' },
  { key: 'manage-payment-config', group: 'DO', label: 'Manage payment provider settings',
    description: 'Configure and test the payment provider (e.g. Monnify) credentials.' },
  { key: 'manage-discount-config', group: 'DO', label: 'Manage discount policy',
    description: 'Configure sibling-discount tiers and default staff-discount percentages.' },
  { key: 'manage-reminder-config', group: 'DO', label: 'Manage reminder settings',
    description: 'Configure the automated due/overdue reminder schedule.' },
  { key: 'manage-team', group: 'DO', label: 'Manage users & roles',
    description: 'Add staff, assign roles, and configure what each role can see and do.' },
]

export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key)

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

// Report types that expose money columns — a user needs BOTH `see-reports` and
// `see-financial-totals` to pull these. Keyed by the ReportType strings used in
// src/lib/reports/reports.ts. The student directory is non-financial (its
// credit_balance column is dropped when the user lacks see-financial-totals).
export const FINANCIAL_REPORT_TYPES = new Set<string>([
  'debtors', 'collections', 'class-summary', 'invoices', 'discounts',
])
