import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// "What we store" — a plain-language inventory of the personal/business data
// held for a school, with live counts. Read-only and owner-scoped; powers the
// transparency section of Settings → Data & privacy. Every count is a HEAD
// query (no rows fetched) and they run in parallel, so the whole panel is one
// fast round-trip's worth of work.
// ---------------------------------------------------------------------------

export interface InventoryCategory {
  key: string
  label: string
  description: string
  count: number
  /** Optional one-line breakdown, e.g. status split for students. */
  detail?: string
}

async function countOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  schoolId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
  if (error) return 0
  return count ?? 0
}

// Count students in one status. Used to make it visible that the records we
// hold (and export) include past students — graduated and withdrawn — not just
// the currently-active roll.
async function countStudentsByStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  schoolId: string,
  status: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', status)
  if (error) return 0
  return count ?? 0
}

export async function getDataInventory(schoolId: string): Promise<InventoryCategory[]> {
  const supabase = await createClient()

  const [
    students,
    families,
    classes,
    sections,
    sessions,
    cycles,
    feeItems,
    invoices,
    payments,
    discounts,
    messages,
    staff,
    activeStudents,
    graduatedStudents,
    withdrawnStudents,
  ] = await Promise.all([
    countOf(supabase, 'students', schoolId),
    countOf(supabase, 'families', schoolId),
    countOf(supabase, 'classes', schoolId),
    countOf(supabase, 'sections', schoolId),
    countOf(supabase, 'sessions', schoolId),
    countOf(supabase, 'billing_cycles', schoolId),
    countOf(supabase, 'fee_items', schoolId),
    countOf(supabase, 'invoices', schoolId),
    countOf(supabase, 'payments', schoolId),
    countOf(supabase, 'discounts', schoolId),
    countOf(supabase, 'message_logs', schoolId),
    countOf(supabase, 'users', schoolId),
    countStudentsByStatus(supabase, schoolId, 'active'),
    countStudentsByStatus(supabase, schoolId, 'graduated'),
    countStudentsByStatus(supabase, schoolId, 'withdrawn'),
  ])

  // Make the historical coverage explicit: past students (graduated/withdrawn)
  // are kept, counted and exported alongside the active roll.
  const studentDetail =
    students > 0
      ? `${activeStudents.toLocaleString()} active · ${graduatedStudents.toLocaleString()} graduated · ${withdrawnStudents.toLocaleString()} withdrawn`
      : undefined

  return [
    {
      key: 'students',
      label: 'Student records',
      description:
        'Names, class/section, admission details and status for every student — including those who have graduated or withdrawn.',
      count: students,
      detail: studentDetail,
    },
    {
      key: 'families',
      label: 'Parent / guardian contacts',
      description: 'Parent and guardian names, phone numbers and email addresses used for billing and reminders.',
      count: families,
    },
    {
      key: 'academic',
      label: 'Academic structure',
      description: 'Classes, sections, academic sessions and billing terms.',
      count: classes + sections + sessions + cycles,
    },
    {
      key: 'fees',
      label: 'Fee structure',
      description: 'The fee items, amounts and opt-in settings that make up your billing.',
      count: feeItems,
    },
    {
      key: 'invoices',
      label: 'Invoices',
      description: 'Every invoice raised against a student, including line items and balances.',
      count: invoices,
    },
    {
      key: 'payments',
      label: 'Payment records',
      description: 'Transfers and payments received, with amounts, dates and provider references.',
      count: payments,
    },
    {
      key: 'discounts',
      label: 'Discounts',
      description: 'Discounts requested, approved or applied to invoices.',
      count: discounts,
    },
    {
      key: 'messages',
      label: 'Messages sent',
      description: 'A log of SMS and email reminders/receipts sent to parents (recipient, type and delivery status).',
      count: messages,
    },
    {
      key: 'staff',
      label: 'Staff accounts',
      description: 'The staff who can sign in to this account, their names, emails and assigned roles.',
      count: staff,
    },
  ]
}

// ---------------------------------------------------------------------------
// Sub-processors: the third parties that data is shared with to run the
// service. Surfaced verbatim in the transparency section — the NDPR/GDPR
// "who do you share my data with?" answer. Keep this list in sync with the
// providers actually wired up (see the messaging/payments adapters).
// ---------------------------------------------------------------------------

export interface SubProcessor {
  name: string
  purpose: string
  data: string
}

export const SUB_PROCESSORS: SubProcessor[] = [
  {
    name: 'Monnify (TeamApt/Moniepoint)',
    purpose: 'Bank transfer collection & virtual accounts',
    data: 'Student/invoice references, amounts, virtual account details',
  },
  {
    name: 'Sendchamp',
    purpose: 'SMS delivery',
    data: 'Parent phone numbers and message contents',
  },
  {
    name: 'Termii',
    purpose: 'SMS delivery (fallback provider)',
    data: 'Parent phone numbers and message contents',
  },
  {
    name: 'Brevo',
    purpose: 'Email delivery',
    data: 'Parent email addresses and message contents',
  },
  {
    name: 'Supabase',
    purpose: 'Database & authentication hosting',
    data: 'All application data, encrypted at rest',
  },
  {
    name: 'Vercel',
    purpose: 'Application hosting',
    data: 'Request/traffic data; no primary data storage',
  },
]
