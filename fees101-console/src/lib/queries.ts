import { createServiceRoleClient } from './supabase/serviceRole'

export interface SchoolOverviewRow {
  id: string
  name: string
  createdAt: string
  subscriptionStatus: string
  billingStatus: string
  termsPerYear: number
  studentCount: number
}

export async function getSchoolsOverview(): Promise<SchoolOverviewRow[]> {
  const supabase = createServiceRoleClient()

  const [{ data: schools }, { data: billing }, { data: students }] = await Promise.all([
    supabase.from('schools').select('id, name, created_at, subscription_status, terms_per_year'),
    supabase.from('platform_billing').select('school_id, billing_status'),
    supabase.from('students').select('school_id').eq('status', 'active'),
  ])

  const billingBySchool = new Map((billing || []).map(b => [b.school_id, b]))
  const studentCountByschool = new Map<string, number>()
  ;(students || []).forEach(s => {
    studentCountByschool.set(s.school_id, (studentCountByschool.get(s.school_id) || 0) + 1)
  })

  return (schools || []).map(s => {
    const b = billingBySchool.get(s.id)
    return {
      id: s.id,
      name: s.name,
      createdAt: s.created_at,
      subscriptionStatus: s.subscription_status,
      billingStatus: b?.billing_status || 'active',
      termsPerYear: s.terms_per_year || 3,
      studentCount: studentCountByschool.get(s.id) || 0,
    }
  })
}

export interface SchoolUsage {
  smsCount: number
  smsCost: number
  emailCount: number
  emailCost: number
  totalCost: number
  // No byte-level storage accounting exists anywhere in the schools-facing
  // app (only row counts, via its Data & Privacy inventory). Row count
  // across the heaviest tables is used here as a rough load proxy until a
  // real storage-size job exists.
  rowCountProxy: number
}

export async function getSchoolUsage(schoolId: string): Promise<SchoolUsage> {
  const supabase = createServiceRoleClient()

  const { data: messages } = await supabase
    .from('message_logs')
    .select('channel, cost_amount')
    .eq('school_id', schoolId)

  let smsCount = 0, smsCost = 0, emailCount = 0, emailCost = 0
  ;(messages || []).forEach(m => {
    const cost = Number(m.cost_amount || 0)
    if (m.channel === 'sms') { smsCount++; smsCost += cost }
    else if (m.channel === 'email') { emailCount++; emailCost += cost }
  })

  const [{ count: studentRows }, { count: invoiceRows }, { count: messageRows }] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('message_logs').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
  ])

  return {
    smsCount,
    smsCost,
    emailCount,
    emailCost,
    totalCost: smsCost + emailCost,
    rowCountProxy: (studentRows || 0) + (invoiceRows || 0) + (messageRows || 0),
  }
}

export interface SchoolDetail {
  id: string
  name: string
  termsPerYear: number
  // Identity facts for the detail page's header strip, visible regardless of
  // which tab is open — added 2026-10-10, a real gap: the page previously
  // showed status/student count/signup date only inside specific tabs, so a
  // support call ("when did they sign up? how many students?") needed a click
  // before it could be answered.
  createdAt: string
  paymentProvider: string | null
  subscriptionStatus: string
  activeStudentCount: number
  billing: {
    // Raw value from the DB column — null means the school has never had an
    // override set and is silently using the platform default of 500.
    pricePerStudentMonth: number | null
    onboardingAt: string | null
    billingStatus: string
    nextChargeDueAt: string | null
    lastChargedAt: string | null
    lastChargeAmount: number | null
    hasSavedCard: boolean
    cardLast4: string | null
    paystackEmail: string | null
  }
  // Manual payment entry is a per-school feature Fees101 staff turn on here,
  // only once a signed liability agreement is in place. The owner must also
  // accept an in-app liability affirmation (set on the fees101-web side) before
  // the feature is actually usable by the school.
  manualPaymentEntry: {
    enabled: boolean
    enabledAt: string | null
    enabledById: string | null
    enabledByName: string | null
    liabilityVersion: string | null
    liabilityAcceptedAt: string | null
  }
  // Bank-transfer (DVA) fallback is a per-school flag on platform_billing that
  // Fees101 staff turn on here. It gates the self-serve "pay by bank transfer"
  // choice on /connect-billing. Off by default; the auto-debit mandate is the
  // preferred rail. Read defensively so the detail page still renders if the
  // gate migration has not run yet.
  dvaFallback: {
    enabled: boolean
    enabledAt: string | null
    enabledById: string | null
    enabledByName: string | null
    billingMethod: string
    mandateStatus: string
  }
}

export async function getSchoolDetail(schoolId: string): Promise<SchoolDetail | null> {
  const supabase = createServiceRoleClient()

  const [{ data: school }, { data: billing }, { count: activeStudentCount }] = await Promise.all([
    // '*' (not a fixed column list) so this still resolves pre-migration — a
    // named column that doesn't exist yet (e.g. refunds_enabled, before
    // db/refunds_workflow.sql has run) would 400 the whole query otherwise,
    // taking down every school detail page. Same reasoning as platform_billing's
    // select below.
    supabase.from('schools').select('*').eq('id', schoolId).maybeSingle(),
    supabase.from('platform_billing').select('*').eq('school_id', schoolId).maybeSingle(),
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'active'),
  ])

  if (!school) return null

  // Resolve the enabling admin's uuid to a name when we have one. platform_admins
  // is a small table, so this is a cheap single lookup rather than a join.
  let enabledByName: string | null = null
  if (school.manual_payment_entry_enabled_by) {
    const { data: enabler } = await supabase
      .from('platform_admins')
      .select('name')
      .eq('id', school.manual_payment_entry_enabled_by)
      .maybeSingle()
    enabledByName = enabler?.name ?? null
  }

  // Same cheap lookup for the admin who enabled the bank-transfer (DVA) fallback.
  // billing is selected with '*', so dva_fallback_enabled_by is simply undefined
  // if the gate migration has not been applied yet (defensive, no crash).
  let dvaEnabledByName: string | null = null
  if (billing?.dva_fallback_enabled_by) {
    const { data: enabler } = await supabase
      .from('platform_admins')
      .select('name')
      .eq('id', billing.dva_fallback_enabled_by)
      .maybeSingle()
    dvaEnabledByName = enabler?.name ?? null
  }

  return {
    id: school.id,
    name: school.name,
    termsPerYear: school.terms_per_year || 3,
    createdAt: school.created_at,
    paymentProvider: school.payment_provider || null,
    subscriptionStatus: school.subscription_status || 'active',
    activeStudentCount: activeStudentCount || 0,
    billing: {
      pricePerStudentMonth: billing?.price_per_student_month != null ? Number(billing.price_per_student_month) : null,
      onboardingAt: billing?.onboarding_at || null,
      billingStatus: billing?.billing_status || 'active',
      nextChargeDueAt: billing?.next_charge_due_at || null,
      lastChargedAt: billing?.last_charged_at || null,
      lastChargeAmount: billing?.last_charge_amount ? Number(billing.last_charge_amount) : null,
      hasSavedCard: !!billing?.paystack_authorization_code,
      cardLast4: null,
      paystackEmail: billing?.paystack_email || null,
    },
    manualPaymentEntry: {
      enabled: !!school.manual_payment_entry_enabled,
      enabledAt: school.manual_payment_entry_enabled_at || null,
      enabledById: school.manual_payment_entry_enabled_by || null,
      enabledByName,
      liabilityVersion: school.manual_payment_liability_version || null,
      liabilityAcceptedAt: school.manual_payment_liability_accepted_at || null,
    },
    dvaFallback: {
      enabled: !!billing?.dva_fallback_enabled,
      enabledAt: billing?.dva_fallback_enabled_at || null,
      enabledById: billing?.dva_fallback_enabled_by || null,
      enabledByName: dvaEnabledByName,
      billingMethod: billing?.billing_method || 'mandate',
      mandateStatus: billing?.mandate_status || 'none',
    },
  }
}

// Charge history and the per-school audit log used to be embedded in
// getSchoolDetail capped at .limit(20), which silently hid everything older
// than the last 20 rows with no way to see more. Split into their own
// server-side paginated queries (same .range() + count:'exact' shape as
// getPlatformAuditLog) so the School detail page's Legacy and Activity tabs
// can page through full history.

export interface SchoolChargeRow {
  id: string
  amount: number
  status: string
  createdAt: string
  failureReason: string | null
}

const SCHOOL_CHARGES_PAGE_SIZE = 20

export async function getSchoolCharges(schoolId: string, page = 1): Promise<{ rows: SchoolChargeRow[]; total: number }> {
  const supabase = createServiceRoleClient()
  const p = Math.max(1, page)
  const from = (p - 1) * SCHOOL_CHARGES_PAGE_SIZE
  const to = from + SCHOOL_CHARGES_PAGE_SIZE - 1

  const { data, count } = await supabase
    .from('platform_billing_charges')
    .select('id, amount, status, created_at, failure_reason', { count: 'exact' })
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .range(from, to)

  return {
    rows: (data || []).map(c => ({
      id: c.id,
      amount: Number(c.amount),
      status: c.status,
      createdAt: c.created_at,
      failureReason: c.failure_reason,
    })),
    total: count || 0,
  }
}

export interface SchoolAuditRow {
  id: string
  actorName: string
  action: string
  summary: string
  createdAt: string
}

const SCHOOL_AUDIT_PAGE_SIZE = 20

export async function getSchoolAuditLog(schoolId: string, page = 1): Promise<{ rows: SchoolAuditRow[]; total: number }> {
  const supabase = createServiceRoleClient()
  const p = Math.max(1, page)
  const from = (p - 1) * SCHOOL_AUDIT_PAGE_SIZE
  const to = from + SCHOOL_AUDIT_PAGE_SIZE - 1

  const { data, count } = await supabase
    .from('platform_audit_log')
    .select('id, actor_name, action, summary, created_at', { count: 'exact' })
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .range(from, to)

  return {
    rows: (data || []).map(a => ({
      id: a.id,
      actorName: a.actor_name,
      action: a.action,
      summary: a.summary,
      createdAt: a.created_at,
    })),
    total: count || 0,
  }
}

export interface SchoolSetupChecklist {
  paymentProvider: string | null
  paymentProviderConnected: boolean
  keysVerified: boolean
  activeCycleName: string | null
  feeItemCount: number
  billingConfigured: boolean
  studentCount: number
  studentsAdded: boolean
}

// The compulsory pre-collection steps a school completes itself in the
// school-facing app — this is read-only status computed from the same
// tables/conditions that app uses (see payments.ts's isConfigured), not a
// manual checkbox. Webhooks aren't a separate item: the endpoint is a fixed
// per-school URL that goes live the moment a provider is connected, there's
// no independent DB state for it.
export async function getSchoolSetupChecklist(schoolId: string): Promise<SchoolSetupChecklist> {
  const supabase = createServiceRoleClient()

  const [{ data: school }, { data: activeCycle }, { count: studentCount }] = await Promise.all([
    supabase.from('schools').select('payment_provider, provider_api_key, provider_secret_key, provider_contract_code, keys_verified_at').eq('id', schoolId).maybeSingle(),
    supabase.from('billing_cycles').select('id, name').eq('school_id', schoolId).eq('status', 'active').maybeSingle(),
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('status', 'active'),
  ])

  const hasApiKey = !!school?.provider_api_key
  const hasSecretKey = !!school?.provider_secret_key
  const hasContractCode = school?.payment_provider === 'monnify' ? !!school?.provider_contract_code : true
  const paymentProviderConnected = !!school?.payment_provider && hasApiKey && hasSecretKey && hasContractCode

  const { count: feeItemCount } = activeCycle
    ? await supabase.from('fee_items').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('billing_cycle_id', activeCycle.id)
    : { count: 0 }

  return {
    paymentProvider: school?.payment_provider || null,
    paymentProviderConnected,
    keysVerified: !!school?.keys_verified_at,
    activeCycleName: activeCycle?.name || null,
    feeItemCount: feeItemCount || 0,
    billingConfigured: !!activeCycle && (feeItemCount || 0) > 0,
    studentCount: studentCount || 0,
    studentsAdded: (studentCount || 0) > 0,
  }
}

export interface MandateBillingSummary {
  onboardingAt: string | null
  billingConnectedAt: string | null
  setupFeeStatus: string
  setupFeeAmount: number
  setupFeePaidAt: string | null
  mandateStatus: string
  mandateEmail: string | null
  mandateAuthorizationCodeMasked: string | null
  mandateAuthorizedAt: string | null
  mandateActiveAt: string | null
  termsAcceptedAt: string | null
  termsVersion: string | null
  billingStatus: string
  nextChargeDueAt: string | null
  lastChargedAt: string | null
  lastChargeAmount: number | null
  lastChargeReference: string | null
  recentCharges: {
    id: string
    amount: number
    status: string
    chargedBy: string | null
    createdAt: string
    paidAt: string | null
    failureReason: string | null
  }[]
}

function maskAuthCode(code: string | null): string | null {
  if (!code) return null
  return code.length <= 8 ? code : `${code.slice(0, 4)}…${code.slice(-4)}`
}

// Key facts about a school's direct-debit mandate and setup — the fields the
// owner wants visible without going into Supabase (platform_billing is
// service-role-only, no admin DB UI). Read-only: this surfaces state set by
// the connect-billing flow and the recurring-debit cron, it doesn't act.
export async function getMandateBillingSummary(schoolId: string): Promise<MandateBillingSummary> {
  const supabase = createServiceRoleClient()

  const [{ data: billing }, { data: charges }] = await Promise.all([
    supabase
      .from('platform_billing')
      .select(
        'onboarding_at, billing_connected_at, setup_fee_status, setup_fee_amount, setup_fee_paid_at, mandate_status, mandate_email, mandate_authorization_code, mandate_authorized_at, mandate_active_at, terms_accepted_at, terms_version, billing_status, next_charge_due_at, last_charged_at, last_charge_amount, last_charge_reference',
      )
      .eq('school_id', schoolId)
      .maybeSingle(),
    supabase
      .from('platform_billing_charges')
      .select('id, amount, status, charged_by, created_at, paid_at, failure_reason')
      .eq('school_id', schoolId)
      .eq('method', 'direct_debit')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  return {
    onboardingAt: billing?.onboarding_at || null,
    billingConnectedAt: billing?.billing_connected_at || null,
    setupFeeStatus: billing?.setup_fee_status || 'unpaid',
    setupFeeAmount: Number(billing?.setup_fee_amount || 0),
    setupFeePaidAt: billing?.setup_fee_paid_at || null,
    mandateStatus: billing?.mandate_status || 'none',
    mandateEmail: billing?.mandate_email || null,
    mandateAuthorizationCodeMasked: maskAuthCode(billing?.mandate_authorization_code || null),
    mandateAuthorizedAt: billing?.mandate_authorized_at || null,
    mandateActiveAt: billing?.mandate_active_at || null,
    termsAcceptedAt: billing?.terms_accepted_at || null,
    termsVersion: billing?.terms_version || null,
    billingStatus: billing?.billing_status || 'active',
    nextChargeDueAt: billing?.next_charge_due_at || null,
    lastChargedAt: billing?.last_charged_at || null,
    lastChargeAmount: billing?.last_charge_amount ? Number(billing.last_charge_amount) : null,
    lastChargeReference: billing?.last_charge_reference || null,
    recentCharges: (charges || []).map(c => ({
      id: c.id,
      amount: Number(c.amount),
      status: c.status,
      chargedBy: c.charged_by,
      createdAt: c.created_at,
      paidAt: c.paid_at,
      failureReason: c.failure_reason,
    })),
  }
}

export interface SchoolOffMandateRow {
  id: string
  name: string
  // Which rail the school is on instead of an active auto-debit mandate, for a
  // scannable outreach list.
  rail: string
}

// Schools whose billing is connected but that are NOT on an active auto-debit
// mandate — the retention rail. These are the schools the owner reaches out to.
// A school counts as off-mandate when it is on the bank-transfer (DVA) rail, or
// its mandate was deactivated, or its mandate is not active. Schools that have
// not connected billing yet are excluded (nothing to chase). platform_billing
// is read with '*' so the newer billing_method / mandate_deactivated_at columns
// are read defensively and a missing column never crashes the overview.
export async function getSchoolsNotOnMandate(): Promise<SchoolOffMandateRow[]> {
  const supabase = createServiceRoleClient()

  const [{ data: schools }, { data: billing }] = await Promise.all([
    supabase.from('schools').select('id, name'),
    supabase.from('platform_billing').select('*'),
  ])

  const nameBySchool = new Map((schools || []).map(s => [s.id, s.name as string]))

  const rows: SchoolOffMandateRow[] = []
  for (const b of billing || []) {
    // Only chase schools that have actually connected billing.
    if (!b.billing_connected_at) continue

    const method = b.billing_method || 'mandate'
    const mandateStatus = b.mandate_status || 'none'
    const deactivated = !!b.mandate_deactivated_at
    const onActiveMandate = method === 'mandate' && mandateStatus === 'active' && !deactivated
    if (onActiveMandate) continue

    const name = nameBySchool.get(b.school_id)
    if (!name) continue

    const rail =
      method === 'dva'
        ? 'Bank transfer (DVA)'
        : deactivated
          ? 'Mandate deactivated'
          : `Mandate ${mandateStatus}`

    rows.push({ id: b.school_id, name, rail })
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

// getAllSchoolsCostToServe() previously lived here — it powered the Schools
// list page's "Messaging cost" column/total, which was removed (2026-10-10):
// message_logs.cost_amount is a known pre-existing bug and is always ₦0, so
// that number was always wrong. Fixing cost_amount itself is out of scope;
// see getSchoolUsage() above for the still-live per-school usage read used on
// the single-school detail page.

export interface SchoolsListRow {
  id: string
  name: string
  createdAt: string
  billingStatus: string
  studentCount: number
  paymentProvider: string | null
  pricePerStudentMonth: number
  onAccrualPath: boolean
  mandateRail: string
}

export interface SchoolsListResult {
  rows: SchoolsListRow[]
  total: number
}

// Paginated, searchable, FILTERABLE version of the schools list for the
// /schools page. Rebuilt 2026-10-10 to close a real gap against
// docs/platform-dashboard-architecture.md §4.2 ("Directory: searchable,
// filterable (status, billing state, provider, size)") — the page had search
// but no status/provider filter and no sort at all. Billing status lives on
// platform_billing (a join), so it can't be filtered at the `schools`-table
// query level the way name/provider can; this now fetches every school
// MATCHING the cheap DB-level filters (name/provider) unpaginated, joins
// billing+students, then applies the billing-status filter and sort in JS
// before paginating. Bounded by TENANT count, not row count — same reasoning
// getAllSchoolsBillingOverview/getBusinessRevenue already use elsewhere in
// this console — safe at any realistic school count, and still cheaper than
// before for a filtered search (fewer schools to join against).
export async function getSchoolsListPage(opts: {
  page?: number
  perPage?: number
  q?: string
  billingStatus?: string
  provider?: string
  sort?: 'newest' | 'oldest' | 'name' | 'students_desc'
} = {}): Promise<SchoolsListResult> {
  const supabase = createServiceRoleClient()
  const page = Math.max(1, opts.page ?? 1)
  const perPage = opts.perPage ?? 20
  const q = (opts.q ?? '').trim()

  let schoolsQuery = supabase
    .from('schools')
    .select('id, name, created_at, payment_provider')
    .order('created_at', { ascending: false })

  if (q) schoolsQuery = schoolsQuery.ilike('name', `%${q}%`)
  if (opts.provider) schoolsQuery = schoolsQuery.eq('payment_provider', opts.provider)

  const { data: schools } = await schoolsQuery
  const schoolIds = (schools || []).map(s => s.id)

  if (schoolIds.length === 0) {
    return { rows: [], total: 0 }
  }

  const [{ data: billing }, { data: students }] = await Promise.all([
    supabase
      .from('platform_billing')
      .select('school_id, billing_status, price_per_student_month, onboarding_at, billing_connected_at, billing_method, mandate_status, mandate_deactivated_at')
      .in('school_id', schoolIds),
    supabase.from('students').select('school_id').eq('status', 'active').in('school_id', schoolIds),
  ])

  const billingBySchool = new Map((billing || []).map(b => [b.school_id, b]))
  const studentCountBySchool = new Map<string, number>()
  ;(students || []).forEach(s => {
    studentCountBySchool.set(s.school_id, (studentCountBySchool.get(s.school_id) || 0) + 1)
  })

  let rows: SchoolsListRow[] = (schools || []).map(s => {
    const b = billingBySchool.get(s.id)

    // Same "which rail" logic as getSchoolsNotOnMandate() above, inlined here
    // since this needs it per-row rather than filtered to only the off-mandate
    // set.
    let mandateRail = 'Not connected'
    if (b?.billing_connected_at) {
      const method = b.billing_method || 'mandate'
      const mandateStatus = b.mandate_status || 'none'
      const deactivated = !!b.mandate_deactivated_at
      const onActiveMandate = method === 'mandate' && mandateStatus === 'active' && !deactivated
      mandateRail = onActiveMandate
        ? 'Mandate (active)'
        : method === 'dva'
          ? 'Bank transfer (DVA)'
          : deactivated
            ? 'Mandate deactivated'
            : `Mandate ${mandateStatus}`
    }

    return {
      id: s.id,
      name: s.name,
      createdAt: s.created_at,
      billingStatus: b?.billing_status || 'active',
      studentCount: studentCountBySchool.get(s.id) || 0,
      paymentProvider: s.payment_provider || null,
      pricePerStudentMonth: Number(b?.price_per_student_month ?? 500),
      onAccrualPath: !!b?.onboarding_at,
      mandateRail,
    }
  })

  if (opts.billingStatus) {
    rows = rows.filter(r => r.billingStatus === opts.billingStatus)
  }

  if (opts.sort === 'name') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name))
  else if (opts.sort === 'oldest') rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  else if (opts.sort === 'students_desc') rows = [...rows].sort((a, b) => b.studentCount - a.studentCount)
  // default 'newest' — already ordered by created_at desc from the DB query above.

  const total = rows.length
  const from = (page - 1) * perPage
  const paged = rows.slice(from, from + perPage)

  return { rows: paged, total }
}
