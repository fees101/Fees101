import { createServiceRoleClient } from './supabase/serviceRole'

// Cross-tenant, read-only queries backing the console's "fill the stub pages"
// pass (Health, Audit, Settings, Money oversight). All reads go through the
// service-role client, same as queries.ts — see docs/platform-dashboard-architecture.md
// §4.4/§4.7/§4.8. Nothing here writes; nothing here duplicates fees101-web's
// billing/DVA computation logic (see ROADMAP.md's de-duplication-hazard note).

async function getSchoolNameMap(): Promise<Map<string, string>> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase.from('schools').select('id, name')
  return new Map((data || []).map(s => [s.id as string, s.name as string]))
}

// ---------------------------------------------------------------------------
// Health — background jobs, webhook delivery, SMS webhook matching, stalled
// year-end rollovers. Surfaces existing signals, no new third-party calls.
// ---------------------------------------------------------------------------

export interface JobFailure {
  error: string
  label: string
}

export interface JobRow {
  id: string
  schoolId: string
  schoolName: string
  jobType: string
  status: string
  total: number
  processed: number
  failed: number
  error: string | null
  // Per-item failure detail — this is where the REAL error text lives for
  // most job types (bulk_send, bulk_dva, etc). The top-level `error` column
  // is only set for a whole-job crash; a job that completed with some items
  // failing has `error: null` and the actual reasons in `failures`. 2026-10-10
  // owner feedback ("I don't see failure reasons at all") traced to this —
  // the health summary wasn't selecting `failures` at all, so there was
  // nothing to show regardless of how the error cell was styled.
  failures: JobFailure[]
  payload: Record<string, unknown> | null
  cursor: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  stuck: boolean
}

export interface HealthSummary {
  jobs: {
    runningCount: number
    failedCount: number
    stuckCount: number
    problemRows: JobRow[]
  }
  webhooks: {
    byProviderStatus: { provider: string; status: string; count: number }[]
    recentProblems: {
      id: string
      schoolName: string
      provider: string
      eventType: string
      status: string
      errorMessage: string | null
      receivedAt: string
    }[]
  }
  smsWebhooks: {
    totalRecent: number
    unmatchedCount: number
  }
  rollovers: {
    stalledCount: number
    stalled: { id: string; schoolName: string; step: string; status: string; errorDetail: string | null; updatedAt: string }[]
    // Full run history (every status, not just in_progress/failed) — added
    // 2026-10-10 so /health/rollovers has something to show once a school's
    // rollover actually succeeds, instead of going blank the moment nothing
    // is stalled. rollover_runs is bounded by schools x years, never a
    // per-payment-scale table, so fetching all rows here is cheap.
    recent: { id: string; schoolId: string; schoolName: string; step: string; status: string; errorDetail: string | null; createdAt: string; updatedAt: string }[]
  }
}

const STUCK_AFTER_MS = 60 * 60 * 1000 // a 'running' job untouched for 1hr+ is presumed stuck

export async function getHealthSummary(): Promise<HealthSummary> {
  const supabase = createServiceRoleClient()
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: jobs }, { data: webhooks }, { data: smsEvents }, { data: rollovers }, names] = await Promise.all([
    supabase.from('background_jobs').select('id, school_id, job_type, status, total, processed, failed, error, failures, payload, cursor, created_at, updated_at').gte('created_at', since30d).order('created_at', { ascending: false }),
    supabase.from('webhook_events').select('id, school_id, provider, event_type, status, error_message, received_at').gte('received_at', since30d).order('received_at', { ascending: false }),
    supabase.from('sms_webhook_events').select('id, matched').gte('created_at', since7d),
    supabase.from('rollover_runs').select('id, school_id, step, status, error_detail, updated_at, created_at'),
    getSchoolNameMap(),
  ])

  const now = Date.now()
  const jobRows: JobRow[] = (jobs || []).map(j => {
    const stuck = j.status === 'running' && now - new Date(j.updated_at).getTime() > STUCK_AFTER_MS
    return {
      id: j.id,
      schoolId: j.school_id,
      schoolName: names.get(j.school_id) || 'Unknown school',
      jobType: j.job_type,
      status: j.status,
      total: j.total || 0,
      processed: j.processed || 0,
      failed: j.failed || 0,
      error: j.error,
      failures: Array.isArray(j.failures) ? j.failures : [],
      payload: j.payload ?? null,
      cursor: j.cursor ?? null,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
      stuck,
    }
  })
  const problemRows = jobRows.filter(j => j.stuck || j.status === 'failed' || j.failed > 0).slice(0, 50)

  const byProviderStatusMap = new Map<string, number>()
  ;(webhooks || []).forEach(w => {
    const key = `${w.provider}::${w.status}`
    byProviderStatusMap.set(key, (byProviderStatusMap.get(key) || 0) + 1)
  })
  const byProviderStatus = Array.from(byProviderStatusMap.entries()).map(([key, count]) => {
    const [provider, status] = key.split('::')
    return { provider, status, count }
  }).sort((a, b) => b.count - a.count)

  // 'duplicate' is excluded deliberately, not an oversight: confirmed against
  // fees101-web's paystackWebhookProcessor.ts — it's set when an idempotency
  // claim correctly rejects a retried delivery (Paystack/Monnify both retry
  // webhooks on no/slow 200), which is CORRECT behaviour, not a failure. It
  // used to count as a "problem" here (and so fed Home's needs-attention
  // queue once that was added in this pass) purely because it isn't literally
  // 'processed' — found and fixed 2026-10-10 while building that queue:
  // every "Paystack charge.success — duplicate" row was noise, not a signal.
  const recentProblems = (webhooks || [])
    .filter(w => w.status !== 'processed' && w.status !== 'duplicate')
    .slice(0, 30)
    .map(w => ({
      id: w.id,
      schoolName: names.get(w.school_id) || 'Unknown school',
      provider: w.provider,
      eventType: w.event_type,
      status: w.status,
      errorMessage: w.error_message,
      receivedAt: w.received_at,
    }))

  const unmatchedCount = (smsEvents || []).filter(e => !e.matched).length

  const stalled = (rollovers || [])
    .filter(r => r.status === 'in_progress' || r.status === 'failed')
    .map(r => ({
      id: r.id,
      schoolName: names.get(r.school_id) || 'Unknown school',
      step: r.step,
      status: r.status,
      errorDetail: r.error_detail,
      updatedAt: r.updated_at,
    }))
  const recentRollovers = (rollovers || [])
    .slice()
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map(r => ({
      id: r.id,
      schoolId: r.school_id,
      schoolName: names.get(r.school_id) || 'Unknown school',
      step: r.step,
      status: r.status,
      errorDetail: r.error_detail,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))

  return {
    jobs: {
      runningCount: jobRows.filter(j => j.status === 'running').length,
      failedCount: jobRows.filter(j => j.status === 'failed').length,
      stuckCount: jobRows.filter(j => j.stuck).length,
      problemRows,
    },
    webhooks: { byProviderStatus, recentProblems },
    smsWebhooks: { totalRecent: (smsEvents || []).length, unmatchedCount },
    rollovers: { stalledCount: stalled.length, stalled, recent: recentRollovers },
  }
}

// Full detail for one background job — used by /health/jobs/[id]. Queried
// fresh (not sliced from getHealthSummary's 30-day/50-row problem list) so a
// link to a specific job always resolves, even an older one.
export interface JobDetail extends JobRow {}

// Full job explorer for /health/jobs — dedicated, filterable/paginated query
// (schoolId/status/jobType), separate from getHealthSummary's own jobs slice
// (which stays a fixed "last 30 days, top 50 problems" shape for Home/the
// Health landing page's cross-cutting KPIs). Added 2026-10-10 so a school's
// own detail page can deep-link "this school's jobs" — previously the Jobs
// page had no filter UI at all, the one health sub-page missing one. Mirrors
// getWebhookEvents' shape (facets + filtered/paginated rows + count).
export interface BackgroundJobFilters {
  schoolId?: string
  status?: string // 'stuck' is synthetic — filtered in JS after the status='running' rows are fetched
  jobType?: string
  page?: number
}

export interface BackgroundJobsResult {
  rows: JobRow[]
  total: number
  jobTypes: string[]
}

const JOBS_PAGE_SIZE = 50
const JOBS_WINDOW_DAYS = 30

export async function getBackgroundJobs(filters: BackgroundJobFilters): Promise<BackgroundJobsResult> {
  const supabase = createServiceRoleClient()
  const names = await getSchoolNameMap()
  const since = new Date(Date.now() - JOBS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const page = Math.max(1, filters.page || 1)
  const from = (page - 1) * JOBS_PAGE_SIZE
  const to = from + JOBS_PAGE_SIZE - 1

  let query = supabase
    .from('background_jobs')
    .select('id, school_id, job_type, status, total, processed, failed, error, failures, payload, cursor, created_at, updated_at', { count: 'exact' })
    .gte('created_at', since)

  if (filters.schoolId) query = query.eq('school_id', filters.schoolId)
  if (filters.jobType) query = query.eq('job_type', filters.jobType)
  if (filters.status === 'stuck') query = query.eq('status', 'running')
  else if (filters.status) query = query.eq('status', filters.status)

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to)

  const now = Date.now()
  let rows: JobRow[] = (data || []).map(j => {
    const stuck = j.status === 'running' && now - new Date(j.updated_at).getTime() > STUCK_AFTER_MS
    return {
      id: j.id,
      schoolId: j.school_id,
      schoolName: names.get(j.school_id) || 'Unknown school',
      jobType: j.job_type,
      status: j.status,
      total: j.total || 0,
      processed: j.processed || 0,
      failed: j.failed || 0,
      error: j.error,
      failures: Array.isArray(j.failures) ? j.failures : [],
      payload: j.payload ?? null,
      cursor: j.cursor ?? null,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
      stuck,
    }
  })

  // 'stuck' is computed, not a DB column — the query above already narrowed
  // to status='running' for this filter, so this just drops the ones that
  // turned out not to be stuck yet (still running within the threshold).
  let total = count || 0
  if (filters.status === 'stuck') {
    rows = rows.filter(j => j.stuck)
    total = rows.length // approximate under this filter+page combination, acceptable at today's job volume
  }

  const { data: typeRows } = await supabase.from('background_jobs').select('job_type').gte('created_at', since).limit(2000)
  const jobTypes = Array.from(new Set((typeRows || []).map(r => r.job_type as string))).sort()

  return { rows, total, jobTypes }
}

export async function getBackgroundJobById(id: string): Promise<JobDetail | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('background_jobs')
    .select('id, school_id, job_type, status, total, processed, failed, error, failures, payload, cursor, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const names = await getSchoolNameMap()
  const stuck = data.status === 'running' && Date.now() - new Date(data.updated_at).getTime() > STUCK_AFTER_MS
  return {
    id: data.id,
    schoolId: data.school_id,
    schoolName: names.get(data.school_id) || 'Unknown school',
    jobType: data.job_type,
    status: data.status,
    total: data.total || 0,
    processed: data.processed || 0,
    failed: data.failed || 0,
    error: data.error,
    failures: Array.isArray(data.failures) ? data.failures : [],
    payload: data.payload ?? null,
    cursor: data.cursor ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    stuck,
  }
}

// ---------------------------------------------------------------------------
// Webhook event explorer — search/filter/paginate the full webhook_events
// table (payment-provider webhooks: Paystack/Monnify) so support triage never
// needs a trip into Supabase. 2026-10-10 owner feedback: "I need to be able
// to search filter see the stats see the details on each of those webhooks."
// Mirrors the audit log's searchParams + buildQuery + .range() convention.
// ---------------------------------------------------------------------------

export interface WebhookEventRow {
  id: string
  schoolId: string
  schoolName: string
  provider: string
  eventType: string | null
  transactionReference: string | null
  status: string
  errorMessage: string | null
  receivedAt: string
  processedAt: string | null
}

export interface WebhookEventFilters {
  schoolId?: string
  provider?: string
  eventType?: string
  status?: string
  search?: string
  from?: string
  to?: string
  page?: number
}

export interface WebhookEventsResult {
  rows: WebhookEventRow[]
  total: number
  statusCounts: Record<string, number>
  eventTypeCounts: Record<string, number>
}

const WEBHOOK_PAGE_SIZE = 50
// Stats are computed server-side over the filtered set (capped — this table
// is small today; if it grows past this a real GROUP BY RPC should replace
// it, but that's new schema surface this pass deliberately avoids).
const WEBHOOK_STATS_CAP = 5000

function applyWebhookEventFilters(query: any, filters: WebhookEventFilters) {
  let q = query
  if (filters.schoolId) q = q.eq('school_id', filters.schoolId)
  if (filters.provider) q = q.eq('provider', filters.provider)
  if (filters.eventType) q = q.eq('event_type', filters.eventType)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.from) q = q.gte('received_at', filters.from)
  if (filters.to) q = q.lte('received_at', filters.to)
  if (filters.search) {
    const term = `%${filters.search}%`
    q = q.or(`transaction_reference.ilike.${term},error_message.ilike.${term}`)
  }
  return q
}

export async function getWebhookEventFacets(): Promise<{ providers: string[]; statuses: string[]; eventTypes: string[] }> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase.from('webhook_events').select('provider, status, event_type').limit(WEBHOOK_STATS_CAP)
  const providers = Array.from(new Set((data || []).map(r => r.provider as string))).sort()
  const statuses = Array.from(new Set((data || []).map(r => r.status as string))).sort()
  const eventTypes = Array.from(new Set((data || []).map(r => r.event_type as string).filter(Boolean))).sort()
  return { providers, statuses, eventTypes }
}

export async function getWebhookEvents(filters: WebhookEventFilters): Promise<WebhookEventsResult> {
  const supabase = createServiceRoleClient()
  const names = await getSchoolNameMap()

  const page = Math.max(1, filters.page || 1)
  const from = (page - 1) * WEBHOOK_PAGE_SIZE
  const to = from + WEBHOOK_PAGE_SIZE - 1

  const [{ data, count }, { data: statsRows }] = await Promise.all([
    applyWebhookEventFilters(
      supabase.from('webhook_events').select('id, school_id, provider, event_type, transaction_reference, status, error_message, received_at, processed_at', { count: 'exact' }),
      filters
    ).order('received_at', { ascending: false }).range(from, to),
    applyWebhookEventFilters(supabase.from('webhook_events').select('status, event_type'), filters).limit(WEBHOOK_STATS_CAP),
  ])

  const statusCounts: Record<string, number> = {}
  const eventTypeCounts: Record<string, number> = {}
  ;(statsRows || []).forEach((r: any) => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1
    const et = r.event_type || 'unknown'
    eventTypeCounts[et] = (eventTypeCounts[et] || 0) + 1
  })

  return {
    rows: (data || []).map((w: any) => ({
      id: w.id,
      schoolId: w.school_id,
      schoolName: names.get(w.school_id) || 'Unknown school',
      provider: w.provider,
      eventType: w.event_type,
      transactionReference: w.transaction_reference,
      status: w.status,
      errorMessage: w.error_message,
      receivedAt: w.received_at,
      processedAt: w.processed_at,
    })),
    total: count || 0,
    statusCounts,
    eventTypeCounts,
  }
}

export interface WebhookEventDetail extends WebhookEventRow {
  rawPayload: unknown
  signatureHeader: string | null
  relatedPaymentIds: string[] | null
  createdAt: string
}

export async function getWebhookEventById(id: string): Promise<WebhookEventDetail | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase.from('webhook_events').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  const names = await getSchoolNameMap()
  return {
    id: data.id,
    schoolId: data.school_id,
    schoolName: names.get(data.school_id) || 'Unknown school',
    provider: data.provider,
    eventType: data.event_type,
    transactionReference: data.transaction_reference,
    status: data.status,
    errorMessage: data.error_message,
    rawPayload: data.raw_payload,
    signatureHeader: data.signature_header,
    relatedPaymentIds: data.related_payment_ids,
    receivedAt: data.received_at,
    processedAt: data.processed_at,
    createdAt: data.created_at,
  }
}

// ---------------------------------------------------------------------------
// SMS/email delivery-webhook explorer — sms_webhook_events. Deliberately a
// thinner explorer than the payment one above: this table (webhook_debug.sql)
// has no school_id (delivery callbacks aren't tenant-scoped at the DB level,
// they're matched back to a message_logs row by reference after the fact) and
// no first-class status/event-type columns — those live inside the `payload`
// jsonb blob (module, status, reference). Filtering/search works against that
// blob via PostgREST's `column->>key` path syntax.
// ---------------------------------------------------------------------------

export interface SmsWebhookEventRow {
  id: string
  source: string
  matched: boolean
  payloadModule: string | null
  payloadStatus: string | null
  reference: string | null
  payload: unknown
  createdAt: string
}

export interface SmsWebhookEventFilters {
  source?: string
  matched?: 'true' | 'false'
  search?: string
  from?: string
  to?: string
  page?: number
}

export interface SmsWebhookEventsResult {
  rows: SmsWebhookEventRow[]
  total: number
  matchedCount: number
  unmatchedCount: number
  bySource: Record<string, number>
}

const SMS_WEBHOOK_PAGE_SIZE = 50
const SMS_WEBHOOK_STATS_CAP = 5000

function applySmsWebhookFilters(query: any, filters: SmsWebhookEventFilters) {
  let q = query
  if (filters.source) q = q.eq('source', filters.source)
  if (filters.matched) q = q.eq('matched', filters.matched === 'true')
  if (filters.from) q = q.gte('created_at', filters.from)
  if (filters.to) q = q.lte('created_at', filters.to)
  if (filters.search) q = q.ilike('payload->>reference', `%${filters.search}%`)
  return q
}

export async function getSmsWebhookFacets(): Promise<{ sources: string[] }> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase.from('sms_webhook_events').select('source').limit(SMS_WEBHOOK_STATS_CAP)
  return { sources: Array.from(new Set((data || []).map(r => r.source as string))).sort() }
}

export async function getSmsWebhookEvents(filters: SmsWebhookEventFilters): Promise<SmsWebhookEventsResult> {
  const supabase = createServiceRoleClient()
  const page = Math.max(1, filters.page || 1)
  const from = (page - 1) * SMS_WEBHOOK_PAGE_SIZE
  const to = from + SMS_WEBHOOK_PAGE_SIZE - 1

  const [{ data, count }, { data: statsRows }] = await Promise.all([
    applySmsWebhookFilters(
      supabase.from('sms_webhook_events').select('id, source, payload, matched, created_at', { count: 'exact' }),
      filters
    ).order('created_at', { ascending: false }).range(from, to),
    applySmsWebhookFilters(supabase.from('sms_webhook_events').select('source, matched'), filters).limit(SMS_WEBHOOK_STATS_CAP),
  ])

  const bySource: Record<string, number> = {}
  let matchedCount = 0
  let unmatchedCount = 0
  ;(statsRows || []).forEach((r: any) => {
    bySource[r.source] = (bySource[r.source] || 0) + 1
    if (r.matched) matchedCount++
    else unmatchedCount++
  })

  return {
    rows: (data || []).map((r: any) => {
      const p = (r.payload || {}) as Record<string, unknown>
      return {
        id: r.id,
        source: r.source,
        matched: r.matched,
        payloadModule: typeof p.module === 'string' ? p.module : null,
        payloadStatus: typeof p.status === 'string' ? p.status : null,
        reference: typeof p.reference === 'string' ? p.reference : null,
        payload: r.payload,
        createdAt: r.created_at,
      }
    }),
    total: count || 0,
    matchedCount,
    unmatchedCount,
    bySource,
  }
}

// ---------------------------------------------------------------------------
// Per-school usage & outliers — "who's spending the most, why are they
// costing more." 2026-10-10 owner feedback. Deliberately built on VOLUME
// (message count, webhook count), not cost_amount: that column is always
// null/₦0 today (known bug, out of scope for this pass) and presenting a
// naira figure from it would be fabricated. Volume-per-active-student and
// webhook-events-per-payment are honest proxies that don't depend on it, and
// flag a school whose ratio is 2x+ the platform average — a disproportionate
// consumer regardless of its absolute size.
// ---------------------------------------------------------------------------

export interface SchoolUsageRow {
  schoolId: string
  schoolName: string
  activeStudents: number
  messageCount: number
  messagesPerStudent: number | null
  messageRatioToAverage: number | null
  webhookCount: number
  paymentCount: number
  webhooksPerPayment: number | null
  webhookRatioToAverage: number | null
  flags: string[]
}

export interface SchoolUsageOutliers {
  platformAvgMessagesPerStudent: number
  platformAvgWebhooksPerPayment: number
  outlierMultiple: number
  schools: SchoolUsageRow[]
}

const USAGE_OUTLIER_MULTIPLE = 2

export async function getSchoolUsageOutliers(): Promise<SchoolUsageOutliers> {
  const supabase = createServiceRoleClient()

  const [{ data: schools }, { data: students }, { data: messages }, { data: webhooks }, { data: payments }] = await Promise.all([
    supabase.from('schools').select('id, name'),
    supabase.from('students').select('school_id, status'),
    supabase.from('message_logs').select('school_id'),
    supabase.from('webhook_events').select('school_id'),
    supabase.from('payments').select('school_id'),
  ])

  function countBySchool(rows: { school_id: string }[] | null): Map<string, number> {
    const m = new Map<string, number>()
    ;(rows || []).forEach(r => m.set(r.school_id, (m.get(r.school_id) || 0) + 1))
    return m
  }

  const activeStudentsBySchool = new Map<string, number>()
  ;(students || []).filter(s => s.status === 'active').forEach(s => {
    activeStudentsBySchool.set(s.school_id, (activeStudentsBySchool.get(s.school_id) || 0) + 1)
  })
  const messagesBySchool = countBySchool(messages)
  const webhooksBySchool = countBySchool(webhooks)
  const paymentsBySchool = countBySchool(payments)

  const rows: SchoolUsageRow[] = (schools || []).map(s => {
    const activeStudents = activeStudentsBySchool.get(s.id) || 0
    const messageCount = messagesBySchool.get(s.id) || 0
    const webhookCount = webhooksBySchool.get(s.id) || 0
    const paymentCount = paymentsBySchool.get(s.id) || 0
    return {
      schoolId: s.id,
      schoolName: s.name,
      activeStudents,
      messageCount,
      messagesPerStudent: activeStudents > 0 ? messageCount / activeStudents : null,
      messageRatioToAverage: null,
      webhookCount,
      paymentCount,
      webhooksPerPayment: paymentCount > 0 ? webhookCount / paymentCount : null,
      webhookRatioToAverage: null,
      flags: [],
    }
  })

  // Averages exclude schools with an undefined denominator (0 active
  // students, or 0 payments) so an inactive school can't drag the baseline
  // down and make every real school look artificially "high."
  const msgRatios = rows.map(r => r.messagesPerStudent).filter((v): v is number => v !== null)
  const platformAvgMessagesPerStudent = msgRatios.length ? msgRatios.reduce((a, b) => a + b, 0) / msgRatios.length : 0
  const whRatios = rows.map(r => r.webhooksPerPayment).filter((v): v is number => v !== null)
  const platformAvgWebhooksPerPayment = whRatios.length ? whRatios.reduce((a, b) => a + b, 0) / whRatios.length : 0

  rows.forEach(r => {
    if (r.messagesPerStudent !== null && platformAvgMessagesPerStudent > 0) {
      r.messageRatioToAverage = r.messagesPerStudent / platformAvgMessagesPerStudent
      if (r.messageRatioToAverage >= USAGE_OUTLIER_MULTIPLE) {
        r.flags.push(`Messaging ${r.messageRatioToAverage.toFixed(1)}x the platform average per student (${r.messagesPerStudent.toFixed(1)} vs ${platformAvgMessagesPerStudent.toFixed(1)} msgs/student)`)
      }
    }
    if (r.webhooksPerPayment !== null && platformAvgWebhooksPerPayment > 0) {
      r.webhookRatioToAverage = r.webhooksPerPayment / platformAvgWebhooksPerPayment
      if (r.webhookRatioToAverage >= USAGE_OUTLIER_MULTIPLE) {
        r.flags.push(`Webhook traffic ${r.webhookRatioToAverage.toFixed(1)}x the platform average per payment (${r.webhooksPerPayment.toFixed(1)} vs ${platformAvgWebhooksPerPayment.toFixed(1)} events/payment) — possible retry loop or integration issue worth checking`)
      }
    }
  })

  rows.sort((a, b) => Math.max(b.messageRatioToAverage || 0, b.webhookRatioToAverage || 0) - Math.max(a.messageRatioToAverage || 0, a.webhookRatioToAverage || 0))

  return { platformAvgMessagesPerStudent, platformAvgWebhooksPerPayment, outlierMultiple: USAGE_OUTLIER_MULTIPLE, schools: rows }
}

// ---------------------------------------------------------------------------
// Cross-tenant platform audit log — docs/platform-dashboard-architecture.md §4.7.
// Separate from each school's own /settings/audit-log.
// ---------------------------------------------------------------------------

export interface PlatformAuditRow {
  id: string
  actorName: string
  action: string
  schoolId: string | null
  schoolName: string | null
  summary: string
  createdAt: string
}

export interface PlatformAuditFilters {
  actor?: string
  action?: string
  schoolId?: string
  from?: string
  to?: string
  page?: number
}

const AUDIT_PAGE_SIZE = 50

export async function getPlatformAuditLog(filters: PlatformAuditFilters): Promise<{ rows: PlatformAuditRow[]; total: number }> {
  const supabase = createServiceRoleClient()
  const names = await getSchoolNameMap()

  let query = supabase.from('platform_audit_log').select('id, actor_name, action, school_id, summary, created_at', { count: 'exact' })
  if (filters.actor) query = query.eq('actor_name', filters.actor)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.schoolId) query = query.eq('school_id', filters.schoolId)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', filters.to)

  const page = Math.max(1, filters.page || 1)
  const from = (page - 1) * AUDIT_PAGE_SIZE
  const to = from + AUDIT_PAGE_SIZE - 1

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to)

  return {
    rows: (data || []).map(r => ({
      id: r.id,
      actorName: r.actor_name,
      action: r.action,
      schoolId: r.school_id,
      schoolName: r.school_id ? names.get(r.school_id) || 'Unknown school' : null,
      summary: r.summary,
      createdAt: r.created_at,
    })),
    total: count || 0,
  }
}

export async function getPlatformAuditFacets(): Promise<{ actors: string[]; actions: string[] }> {
  const supabase = createServiceRoleClient()
  // Facets from the last 1000 rows is plenty for a dropdown at this scale —
  // avoids a full-table distinct scan.
  const { data } = await supabase.from('platform_audit_log').select('actor_name, action').order('created_at', { ascending: false }).limit(1000)
  const actors = Array.from(new Set((data || []).map(r => r.actor_name))).sort()
  const actions = Array.from(new Set((data || []).map(r => r.action))).sort()
  return { actors, actions }
}

// All matching rows (not one page) for the CSV export — audit entries are
// hand-triggered founder/internal actions, never a payment-scale table, so a
// single capped fetch (5000 rows — effectively "all of it" at this volume)
// is the same "bounded by actor-action count, not row count" reasoning
// getAllSchoolsBillingOverview already uses, applied here instead of adding
// real streaming/offset-export machinery for a table this small.
export async function getPlatformAuditLogAll(filters: Omit<PlatformAuditFilters, 'page'>): Promise<PlatformAuditRow[]> {
  const supabase = createServiceRoleClient()
  const names = await getSchoolNameMap()

  let query = supabase.from('platform_audit_log').select('id, actor_name, action, school_id, summary, created_at')
  if (filters.actor) query = query.eq('actor_name', filters.actor)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.schoolId) query = query.eq('school_id', filters.schoolId)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', filters.to)

  const { data } = await query.order('created_at', { ascending: false }).limit(5000)
  return (data || []).map(r => ({
    id: r.id,
    actorName: r.actor_name,
    action: r.action,
    schoolId: r.school_id,
    schoolName: r.school_id ? names.get(r.school_id) || 'Unknown school' : null,
    summary: r.summary,
    createdAt: r.created_at,
  }))
}

// Action severity — docs/platform-dashboard-architecture.md names this as an
// explicit unbuilt want: "visual distinction for financial/sensitive actions
// (suspend/billing/DVA/impersonate/delete)". Every action string actually
// written to platform_audit_log today (grepped across the console's own
// actions.ts/platformDva.ts/billing.ts call sites, 2026-10-10) is classified
// here so a new action falls back to 'routine' instead of erroring — the
// classification is additive metadata for color/sort only, never a filter
// that could hide an entry.
export type AuditSeverity = 'critical' | 'financial' | 'routine'

const CRITICAL_ACTIONS = new Set([
  'impersonation.started',          // full access to a school's own account
  'billing.mandate_deactivated',    // kills a school's auto-debit collection
  'billing.status_set_manually',    // manual override of the computed billing status
])

export function getAuditSeverity(action: string): AuditSeverity {
  if (CRITICAL_ACTIONS.has(action)) return 'critical'
  if (action.startsWith('billing.') || action.includes('dva') || action.includes('manual_payment_entry')) return 'financial'
  return 'routine'
}

// 30-day counts by severity, independent of whatever the on-screen filter is
// set to — mirrors the webhooks/jobs pages' own "fixed facet query alongside
// the filtered one" convention. Gives the audit log a stat strip instead of
// going straight from the page title into a bare filter form.
export interface AuditStats {
  total30d: number
  criticalCount30d: number
  financialCount30d: number
  impersonationCount30d: number
}

export async function getPlatformAuditStats(): Promise<AuditStats> {
  const supabase = createServiceRoleClient()
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase.from('platform_audit_log').select('action').gte('created_at', since30d)
  const rows = data || []
  return {
    total30d: rows.length,
    criticalCount30d: rows.filter(r => getAuditSeverity(r.action) === 'critical').length,
    financialCount30d: rows.filter(r => getAuditSeverity(r.action) === 'financial').length,
    impersonationCount30d: rows.filter(r => r.action === 'impersonation.started').length,
  }
}

// ---------------------------------------------------------------------------
// Settings — platform admins (read-only list; CRUD is a v2 item per ROADMAP's
// "internal users & permissions v2" gap) + pending school-deletion requests
// (currently invisible anywhere in the console).
// ---------------------------------------------------------------------------

export interface PlatformAdminRow {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
}

export async function getPlatformAdmins(): Promise<PlatformAdminRow[]> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase.from('platform_admins').select('id, name, email, role, created_at').order('created_at', { ascending: true })
  return (data || []).map(a => ({ id: a.id, name: a.name, email: a.email, role: a.role, createdAt: a.created_at }))
}

export interface DeletionRequestRow {
  id: string
  schoolId: string
  schoolName: string
  status: string
  requestedByName: string
  requestedByEmail: string
  scheduledFor: string
  financialPurgeAt: string
  cancelledAt: string | null
  completedAt: string | null
  archivedRecordCount: number | null
}

export interface DeletionRequestFilters {
  status?: string
  page?: number
}

const DELETION_REQUEST_PAGE_SIZE = 20

export async function getScheduledDeletions(filters: DeletionRequestFilters = {}): Promise<{ rows: DeletionRequestRow[]; total: number }> {
  const supabase = createServiceRoleClient()

  let query = supabase
    .from('school_deletion_requests')
    .select('id, school_id, school_name, status, requested_by_name, requested_by_email, scheduled_for, financial_purge_at, cancelled_at, completed_at, archived_record_count', { count: 'exact' })
  if (filters.status) query = query.eq('status', filters.status)

  const page = Math.max(1, filters.page || 1)
  const from = (page - 1) * DELETION_REQUEST_PAGE_SIZE
  const to = from + DELETION_REQUEST_PAGE_SIZE - 1

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to)

  return {
    rows: (data || []).map(d => ({
      id: d.id,
      schoolId: d.school_id,
      schoolName: d.school_name,
      status: d.status,
      requestedByName: d.requested_by_name,
      requestedByEmail: d.requested_by_email,
      scheduledFor: d.scheduled_for,
      financialPurgeAt: d.financial_purge_at,
      cancelledAt: d.cancelled_at,
      completedAt: d.completed_at,
      archivedRecordCount: d.archived_record_count,
    })),
    total: count || 0,
  }
}

// Pending count for the tab badge needs to reflect the whole table, not just
// the current filtered/paginated page — a cheap head-count query.
export async function getPendingDeletionCount(): Promise<number> {
  const supabase = createServiceRoleClient()
  const { count } = await supabase.from('school_deletion_requests').select('id', { count: 'exact', head: true }).eq('status', 'scheduled')
  return count || 0
}

// ---------------------------------------------------------------------------
// Access requests ("leads") from the marketing site — currently invisible
// anywhere in the console, folded into the Onboarding page since they feed it.
// ---------------------------------------------------------------------------

export interface AccessRequestRow {
  id: string
  schoolName: string
  contactName: string
  email: string
  phone: string | null
  studentCount: number | null
  message: string | null
  status: string
  createdAt: string
}

export interface AccessRequestFilters {
  status?: string
  page?: number
}

const ACCESS_REQUEST_PAGE_SIZE = 20

export async function getRecentAccessRequests(filters: AccessRequestFilters = {}): Promise<{ rows: AccessRequestRow[]; total: number }> {
  const supabase = createServiceRoleClient()

  let query = supabase
    .from('access_requests')
    .select('id, school_name, contact_name, email, phone, student_count, message, status, created_at', { count: 'exact' })
  if (filters.status) query = query.eq('status', filters.status)

  const page = Math.max(1, filters.page || 1)
  const from = (page - 1) * ACCESS_REQUEST_PAGE_SIZE
  const to = from + ACCESS_REQUEST_PAGE_SIZE - 1

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to)

  return {
    rows: (data || []).map(r => ({
      id: r.id,
      schoolName: r.school_name,
      contactName: r.contact_name,
      email: r.email,
      phone: r.phone,
      studentCount: r.student_count,
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
    })),
    total: count || 0,
  }
}

export async function getAccessRequestStatuses(): Promise<string[]> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase.from('access_requests').select('status').limit(1000)
  return Array.from(new Set((data || []).map(r => r.status))).sort()
}

// ---------------------------------------------------------------------------
// Money oversight — cross-tenant VISIBILITY ONLY into refunds, manual
// payments, and discounts. Deliberately no approve/reject actions here: those
// are single-school, staff-reviewed workflows inside fees101-web by design
// (ROADMAP.md: "console has no approve UI anywhere" — stated for refunds and
// manual payments alike, same reasoning extends to discounts).
// ---------------------------------------------------------------------------

export interface MoneyOversightRow {
  id: string
  schoolId: string
  schoolName: string
  amount: number
  status: string
  method: string | null
  category: string | null
  createdAt: string
}

export interface MoneySectionFilters {
  status?: string
  schoolId?: string
  from?: string
  to?: string
  page?: number
}

export interface MoneySection {
  statusCounts: Record<string, number>
  thisMonthTotal: number
  rows: MoneyOversightRow[]
  total: number
}

export interface MoneyOversight {
  refunds: MoneySection
  manualPayments: MoneySection
  discounts: MoneySection
}

function startOfMonthIso(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

const MONEY_PAGE_SIZE = 20

// Status counts and this-month total are a lightweight, unfiltered sample —
// context chips for the whole category, not driven by the filter form. The
// row table below them is the real, query-level filtered + paginated view
// (.eq/.gte/.lte + .range(), same shape as getPlatformAuditLog).
async function fetchMoneySection(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: 'refunds' | 'manual_payment_requests' | 'discounts',
  columns: string,
  methodColumn: 'method' | 'refund_method' | null,
  categoryColumn: 'category' | null,
  names: Map<string, string>,
  monthStart: string,
  filters: MoneySectionFilters
): Promise<MoneySection> {
  const { data: statsRows } = await supabase.from(table).select('status, amount, created_at').limit(1000)
  const statusCounts: Record<string, number> = {}
  let thisMonthTotal = 0
  ;(statsRows || []).forEach(r => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1
    if (r.created_at >= monthStart) thisMonthTotal += Number(r.amount) || 0
  })

  let query = supabase.from(table).select(columns, { count: 'exact' })
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.schoolId) query = query.eq('school_id', filters.schoolId)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59`)

  const page = Math.max(1, filters.page || 1)
  const from = (page - 1) * MONEY_PAGE_SIZE
  const to = from + MONEY_PAGE_SIZE - 1

  const { data, count } = await query.order('created_at', { ascending: false }).range(from, to)
  const dataRows = (data || []) as unknown as Record<string, unknown>[]

  const rows: MoneyOversightRow[] = dataRows.map((r) => ({
    id: r.id as string,
    schoolId: r.school_id as string,
    schoolName: names.get(r.school_id as string) || 'Unknown school',
    amount: Number(r.amount) || 0,
    status: r.status as string,
    method: methodColumn ? (r[methodColumn] as string | null) ?? null : null,
    category: categoryColumn ? (r[categoryColumn] as string | null) ?? null : null,
    createdAt: r.created_at as string,
  }))

  return { statusCounts, thisMonthTotal, rows, total: count || 0 }
}

export async function getMoneyOversight(filters: {
  refunds: MoneySectionFilters
  manualPayments: MoneySectionFilters
  discounts: MoneySectionFilters
}): Promise<MoneyOversight> {
  const supabase = createServiceRoleClient()
  const names = await getSchoolNameMap()
  const monthStart = startOfMonthIso()

  const [refunds, manualPayments, discounts] = await Promise.all([
    fetchMoneySection(supabase, 'refunds', 'id, school_id, amount, status, refund_method, category, created_at', 'refund_method', 'category', names, monthStart, filters.refunds),
    fetchMoneySection(supabase, 'manual_payment_requests', 'id, school_id, amount, status, method, created_at', 'method', null, names, monthStart, filters.manualPayments),
    fetchMoneySection(supabase, 'discounts', 'id, school_id, amount, status, category, created_at', null, 'category', names, monthStart, filters.discounts),
  ])

  return { refunds, manualPayments, discounts }
}
