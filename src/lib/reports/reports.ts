import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { actionLabel } from '@/lib/audit/auditLogLabels'
import { toCSV, type CsvValue } from './csv'

// ---------------------------------------------------------------------------
// Report builders for the /reports page. Each report runs its own queries
// against the caller's school and returns a ready CSV. Reports pull DETAIL rows
// (per student / per payment) — unlike the analytics page, which only ever
// works with small per-cycle aggregates — because a downloadable file is a
// one-off action where a full row-by-row export is exactly what's wanted.
//
// Scope: term/session reports resolve to a set of billing-cycle ids (a single
// term, a whole session, or all history). Payment-based reports scope by a
// paid_at date range instead. The student directory scopes by status.
// ---------------------------------------------------------------------------

export type ReportType =
  | 'debtors'
  | 'collections'
  | 'class-summary'
  | 'students'
  | 'invoices'
  | 'discounts'
  | 'audit-log'

export interface ReportParams {
  cycleId?: string
  sessionId?: string
  from?: string          // ISO date (inclusive) for date-range reports
  to?: string            // ISO date (inclusive)
  status?: string        // student directory status filter
}

const n = (v: any) => Number(v) || 0
const name = (s: any) => `${s?.first_name ?? ''} ${s?.last_name ?? ''}`.trim()
const money = (v: any) => Math.round(n(v))

async function resolveContext(supabase: any): Promise<{ schoolId: string | null; userId: string | null }> {
  const ctx = await getAuthContext()
  if (!ctx) return { schoolId: null, userId: null }
  return { schoolId: ctx.schoolId, userId: ctx.userId }
}

async function resolveSchoolId(supabase: any): Promise<string | null> {
  return (await resolveContext(supabase)).schoolId
}

// Resolve the scope to a concrete list of cycle ids, or null for "all history"
// (caller then omits the billing_cycle filter entirely).
async function resolveCycleIds(
  supabase: any, schoolId: string, p: ReportParams,
): Promise<string[] | null> {
  if (p.cycleId) return [p.cycleId]
  if (p.sessionId) {
    const { data } = await supabase
      .from('billing_cycles').select('id')
      .eq('school_id', schoolId).eq('session_id', p.sessionId)
    return (data || []).map((c: any) => c.id)
  }
  return null
}

// Small reference maps, loaded once per report so we never depend on Supabase
// implicit-relationship names (which are brittle on this untyped client).
async function loadMaps(supabase: any, schoolId: string) {
  const [{ data: classes }, { data: sections }, { data: families }, { data: cycles }] = await Promise.all([
    supabase.from('classes').select('id, name').eq('school_id', schoolId),
    supabase.from('sections').select('id, name').eq('school_id', schoolId),
    supabase.from('families').select('id, primary_parent_name, primary_parent_phone, primary_parent_email').eq('school_id', schoolId),
    supabase.from('billing_cycles').select('id, name, start_date, session_id').eq('school_id', schoolId),
  ])
  return {
    className: new Map<string, string>((classes || []).map((c: any) => [c.id, c.name])),
    sectionName: new Map<string, string>((sections || []).map((s: any) => [s.id, s.name])),
    family: new Map<string, any>((families || []).map((f: any) => [f.id, f])),
    cycleName: new Map<string, string>((cycles || []).map((c: any) => [c.id, c.name])),
  }
}

// All students for the school, keyed by id — the spine most reports join to.
async function loadStudents(supabase: any, schoolId: string) {
  const { data } = await supabase
    .from('students')
    .select('id, first_name, last_name, admission_number, admission_date, class_id, section_id, family_id, status, special_category, credit_balance, virtual_account_number, virtual_account_bank')
    .eq('school_id', schoolId)
  const map = new Map<string, any>((data || []).map((s: any) => [s.id, s]))
  return { list: data || [], map }
}

interface BuiltReport { name: string; headers: string[]; rows: CsvValue[][] }

// =====================================================================
// Debtors / outstanding — one row per student with a balance, aggregated
// across the scoped cycles (or all history).
// =====================================================================
async function buildDebtors(supabase: any, schoolId: string, p: ReportParams): Promise<BuiltReport> {
  const [{ className, family }, { map: students }, cycleIds] = await Promise.all([
    loadMaps(supabase, schoolId),
    loadStudents(supabase, schoolId),
    resolveCycleIds(supabase, schoolId, p),
  ])

  let q = supabase.from('invoices')
    .select('student_id, total_amount, paid_amount, outstanding_amount')
    .eq('school_id', schoolId).neq('status', 'cancelled')
  if (cycleIds) q = q.in('billing_cycle_id', cycleIds)
  const { data: invoices } = await q

  const agg = new Map<string, { billed: number; paid: number; outstanding: number }>()
  for (const inv of invoices || []) {
    const e = agg.get(inv.student_id) || { billed: 0, paid: 0, outstanding: 0 }
    e.billed += n(inv.total_amount)
    e.paid += n(inv.paid_amount)
    e.outstanding += n(inv.outstanding_amount)
    agg.set(inv.student_id, e)
  }

  const rows: CsvValue[][] = []
  for (const [studentId, a] of agg) {
    if (a.outstanding <= 0) continue
    const s = students.get(studentId)
    const fam = s?.family_id ? family.get(s.family_id) : null
    rows.push([
      s?.admission_number ?? '', name(s), className.get(s?.class_id) ?? '', s?.status ?? '',
      fam?.primary_parent_name ?? '', fam?.primary_parent_phone ?? '',
      money(a.billed), money(a.paid), money(a.outstanding), money(s?.credit_balance),
    ])
  }
  rows.sort((a, b) => n(b[8]) - n(a[8]))   // largest outstanding first
  return {
    name: 'debtors',
    headers: ['Admission No', 'Student', 'Class', 'Status', 'Parent', 'Phone', 'Billed', 'Paid', 'Outstanding', 'Credit balance'],
    rows,
  }
}

// =====================================================================
// Collections — one row per payment within the date range.
// =====================================================================
async function buildCollections(supabase: any, schoolId: string, p: ReportParams): Promise<BuiltReport> {
  const [{ className }, { map: students }] = await Promise.all([
    loadMaps(supabase, schoolId),
    loadStudents(supabase, schoolId),
  ])

  let q = supabase.from('payments')
    .select('paid_at, student_id, amount, method, sender_name, match_status, receipt_number_external, notes')
    .eq('school_id', schoolId).order('paid_at', { ascending: true })
  if (p.from) q = q.gte('paid_at', p.from)
  if (p.to) q = q.lte('paid_at', p.to + 'T23:59:59.999Z')
  const { data: payments } = await q

  const rows: CsvValue[][] = (payments || []).map((pay: any) => {
    const s = students.get(pay.student_id)
    return [
      (pay.paid_at || '').slice(0, 10), s?.admission_number ?? '', name(s),
      className.get(s?.class_id) ?? '', money(pay.amount), pay.method ?? '',
      pay.sender_name ?? '', pay.match_status ?? '', pay.receipt_number_external ?? '', pay.notes ?? '',
    ]
  })
  return {
    name: 'collections',
    headers: ['Date', 'Admission No', 'Student', 'Class', 'Amount', 'Method', 'Sender', 'Match status', 'External receipt', 'Notes'],
    rows,
  }
}

// =====================================================================
// Per-class summary — billed/collected/outstanding grouped by class.
// =====================================================================
async function buildClassSummary(supabase: any, schoolId: string, p: ReportParams): Promise<BuiltReport> {
  const [{ className }, { map: students }, cycleIds] = await Promise.all([
    loadMaps(supabase, schoolId),
    loadStudents(supabase, schoolId),
    resolveCycleIds(supabase, schoolId, p),
  ])

  let q = supabase.from('invoices')
    .select('student_id, total_amount, paid_amount, outstanding_amount')
    .eq('school_id', schoolId).neq('status', 'cancelled')
  if (cycleIds) q = q.in('billing_cycle_id', cycleIds)
  const { data: invoices } = await q

  const agg = new Map<string, { students: number; billed: number; collected: number; outstanding: number }>()
  for (const inv of invoices || []) {
    const s = students.get(inv.student_id)
    const cls = className.get(s?.class_id) ?? 'Unassigned'
    const e = agg.get(cls) || { students: 0, billed: 0, collected: 0, outstanding: 0 }
    e.students += 1
    e.billed += n(inv.total_amount)
    e.collected += n(inv.paid_amount)
    e.outstanding += n(inv.outstanding_amount)
    agg.set(cls, e)
  }

  const rows: CsvValue[][] = Array.from(agg.entries())
    .map(([cls, a]) => [
      cls, a.students, money(a.billed), money(a.collected), money(a.outstanding),
      a.billed > 0 ? Math.round((a.collected / a.billed) * 100) : 0,
    ])
    .sort((a, b) => n(b[2]) - n(a[2]))
  return {
    name: 'class-summary',
    headers: ['Class', 'Invoices', 'Billed', 'Collected', 'Outstanding', 'Collection rate %'],
    rows,
  }
}

// =====================================================================
// Student directory — snapshot of students, filtered by status.
// =====================================================================
async function buildStudents(supabase: any, schoolId: string, p: ReportParams): Promise<BuiltReport> {
  const [{ className, sectionName, family }, { list }] = await Promise.all([
    loadMaps(supabase, schoolId),
    loadStudents(supabase, schoolId),
  ])
  const status = p.status && p.status !== 'all' ? p.status : null
  const students = status ? list.filter((s: any) => s.status === status) : list

  const rows: CsvValue[][] = students
    .slice()
    .sort((a: any, b: any) => name(a).localeCompare(name(b)))
    .map((s: any) => {
      const fam = s.family_id ? family.get(s.family_id) : null
      return [
        s.admission_number ?? '', s.first_name ?? '', s.last_name ?? '',
        className.get(s.class_id) ?? '', sectionName.get(s.section_id) ?? '', s.status ?? '',
        (s.admission_date || '').slice(0, 10), s.special_category ?? '',
        fam?.primary_parent_name ?? '', fam?.primary_parent_phone ?? '', fam?.primary_parent_email ?? '',
        s.virtual_account_number ?? '', s.virtual_account_bank ?? '', money(s.credit_balance),
      ]
    })
  return {
    name: 'students',
    headers: ['Admission No', 'First name', 'Last name', 'Class', 'Section', 'Status', 'Admission date', 'Special category', 'Parent', 'Phone', 'Email', 'Virtual account', 'Bank', 'Credit balance'],
    rows,
  }
}

// =====================================================================
// Invoices — one row per invoice in scope.
// =====================================================================
async function buildInvoices(supabase: any, schoolId: string, p: ReportParams): Promise<BuiltReport> {
  const [{ className, cycleName }, { map: students }, cycleIds] = await Promise.all([
    loadMaps(supabase, schoolId),
    loadStudents(supabase, schoolId),
    resolveCycleIds(supabase, schoolId, p),
  ])

  let q = supabase.from('invoices')
    .select('student_id, billing_cycle_id, status, subtotal, discount_amount, previous_balance, total_amount, paid_amount, outstanding_amount, generated_at')
    .eq('school_id', schoolId).order('generated_at', { ascending: true })
  if (cycleIds) q = q.in('billing_cycle_id', cycleIds)
  const { data: invoices } = await q

  const rows: CsvValue[][] = (invoices || []).map((inv: any) => {
    const s = students.get(inv.student_id)
    return [
      cycleName.get(inv.billing_cycle_id) ?? '', s?.admission_number ?? '', name(s),
      className.get(s?.class_id) ?? '', inv.status ?? '',
      money(inv.subtotal), money(inv.discount_amount), money(inv.previous_balance),
      money(inv.total_amount), money(inv.paid_amount), money(inv.outstanding_amount),
      (inv.generated_at || '').slice(0, 10),
    ]
  })
  return {
    name: 'invoices',
    headers: ['Term', 'Admission No', 'Student', 'Class', 'Status', 'Subtotal', 'Discount', 'Previous balance', 'Total', 'Paid', 'Outstanding', 'Generated'],
    rows,
  }
}

// =====================================================================
// Discounts — one row per discount, scoped by the invoice's term.
// =====================================================================
async function buildDiscounts(supabase: any, schoolId: string, p: ReportParams): Promise<BuiltReport> {
  const [{ className }, { map: students }, cycleIds] = await Promise.all([
    loadMaps(supabase, schoolId),
    loadStudents(supabase, schoolId),
    resolveCycleIds(supabase, schoolId, p),
  ])

  // When scoping to a term/session, keep only discounts whose invoice is in
  // scope. The in-scope invoice lookup and the discounts fetch are independent
  // (inScope is only applied as a post-filter), so they run together.
  const [invScope, { data: discounts }] = await Promise.all([
    cycleIds
      ? supabase.from('invoices')
          .select('id').eq('school_id', schoolId).in('billing_cycle_id', cycleIds)
      : Promise.resolve({ data: null }),
    supabase.from('discounts')
      .select('invoice_id, student_id, category, is_percentage, amount, status, is_recurring, reason, approved_at')
      .eq('school_id', schoolId).order('created_at', { ascending: true }),
  ])

  const inScope: Set<string> | null = cycleIds
    ? new Set(((invScope as any).data || []).map((i: any) => i.id))
    : null

  const rows: CsvValue[][] = (discounts || [])
    .filter((d: any) => !inScope || inScope.has(d.invoice_id))
    .map((d: any) => {
      const s = students.get(d.student_id)
      return [
        s?.admission_number ?? '', name(s), className.get(s?.class_id) ?? '',
        d.category ?? '', d.is_percentage ? 'percentage' : 'fixed',
        d.is_percentage ? `${n(d.amount)}%` : money(d.amount),
        d.status ?? '', d.is_recurring ? 'yes' : 'no', d.reason ?? '',
        (d.approved_at || '').slice(0, 10),
      ]
    })
  return {
    name: 'discounts',
    headers: ['Admission No', 'Student', 'Class', 'Category', 'Type', 'Value', 'Status', 'Recurring', 'Reason', 'Approved'],
    rows,
  }
}

// =====================================================================
// Audit log — one row per event, newest first, optionally scoped to a
// created_at date range. Exported from the Reports page; the audit-log
// settings page filters by module in-view rather than on export.
// =====================================================================
async function buildAuditLog(supabase: any, schoolId: string, p: ReportParams): Promise<BuiltReport> {
  let q = supabase
    .from('audit_log')
    .select('created_at, actor_name, action, target_type, target_id, summary, metadata')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (p.from) q = q.gte('created_at', p.from)
  if (p.to) q = q.lte('created_at', p.to + 'T23:59:59.999Z')
  const { data } = await q

  const rows: CsvValue[][] = (data || []).map((r: any) => [
    r.created_at, r.actor_name, actionLabel(r.action), r.summary,
  ])
  return {
    name: 'audit-log',
    headers: ['When', 'Who', 'Action', 'Details'],
    rows,
  }
}

// ---------------------------------------------------------------------------
// Scope options for the reports page dropdowns. Sessions (newest first) and the
// terms within each, so the UI can offer "a single term", "a whole session", or
// "all history".
// ---------------------------------------------------------------------------
export interface ScopeSession { id: string; name: string }
export interface ScopeCycle { id: string; name: string; sessionId: string | null }

export async function getReportScope(): Promise<{ sessions: ScopeSession[]; cycles: ScopeCycle[] }> {
  const supabase = await createClient()
  const schoolId = await resolveSchoolId(supabase)
  if (!schoolId) return { sessions: [], cycles: [] }

  const [{ data: sessions }, { data: cycles }] = await Promise.all([
    supabase.from('sessions').select('id, name, start_date')
      .eq('school_id', schoolId).order('start_date', { ascending: false }),
    supabase.from('billing_cycles').select('id, name, session_id, start_date')
      .eq('school_id', schoolId).order('start_date', { ascending: false }),
  ])

  return {
    sessions: (sessions || []).map((s: any) => ({ id: s.id, name: s.name })),
    cycles: (cycles || []).map((c: any) => ({ id: c.id, name: c.name, sessionId: c.session_id })),
  }
}

const BUILDERS: Record<ReportType, (s: any, id: string, p: ReportParams) => Promise<BuiltReport>> = {
  'debtors': buildDebtors,
  'collections': buildCollections,
  'class-summary': buildClassSummary,
  'students': buildStudents,
  'invoices': buildInvoices,
  'discounts': buildDiscounts,
  'audit-log': buildAuditLog,
}

// Human-readable description of the scope, for the download log / history.
async function scopeLabel(supabase: any, type: string, p: ReportParams): Promise<string> {
  if (p.cycleId) {
    const { data } = await supabase.from('billing_cycles').select('name').eq('id', p.cycleId).single()
    return data?.name || 'Single term'
  }
  if (p.sessionId) {
    const { data } = await supabase.from('sessions').select('name').eq('id', p.sessionId).single()
    return data?.name ? `${data.name} (whole session)` : 'Whole session'
  }
  if (p.from || p.to) return `${p.from || '…'} → ${p.to || '…'}`
  if (type === 'students') return `Status: ${p.status || 'active'}`
  return 'All history'
}

// Public entry point used by the export route. Returns the CSV string plus a
// dated filename, and records the download for the audit history. `today` is
// passed in (route handlers can read the clock; keeps the builder testable).
//
// `includeFinancials` controls the one non-financial report (the student
// directory): when false, its money column (credit balance) is dropped so a
// user with see-reports but not see-financial-totals can still pull the
// directory. The route blocks the wholly-financial report types outright.
export async function buildReport(
  type: string, params: ReportParams, today: string,
  opts: { includeFinancials?: boolean } = {},
): Promise<{ filename: string; csv: string }> {
  const builder = BUILDERS[type as ReportType]
  if (!builder) throw new Error(`Unknown report type: ${type}`)

  const supabase = await createClient()
  const { schoolId, userId } = await resolveContext(supabase)
  if (!schoolId) throw new Error('No school in scope')

  let { name, headers, rows } = await builder(supabase, schoolId, params)

  // Drop the credit-balance money column from the directory for users without
  // see-financial-totals. It is always the last column of the students report.
  if (type === 'students' && opts.includeFinancials === false) {
    const idx = headers.indexOf('Credit balance')
    if (idx !== -1) {
      headers = headers.filter((_, i) => i !== idx)
      rows = rows.map(r => r.filter((_, i) => i !== idx))
    }
  }

  const filename = `${name}-${today}.csv`

  // Log the download — best effort; never let an audit failure block the export.
  try {
    const label = await scopeLabel(supabase, type, params)
    await supabase.from('report_downloads').insert({
      school_id: schoolId,
      user_id: userId,
      report_type: type,
      scope_label: label,
      params,
      row_count: rows.length,
      filename,
    })
  } catch { /* ignore logging errors */ }

  // The audit log's own downloads are also logged as an audit event (not just
  // the generic report_downloads row above), so "who pulled the audit log" is
  // visible from the audit log page itself, not only the Reports history.
  if (type === 'audit-log') {
    await logAuditEvent(supabase, {
      schoolId,
      actorId: userId,
      action: 'report.audit_log_downloaded',
      targetType: 'school',
      targetId: schoolId,
      summary: 'Downloaded the audit log',
      metadata: params,
    })
  }

  return { filename, csv: toCSV(headers, rows) }
}

// Recent downloads for the school, newest first — powers the history list on the
// Reports page. Joins the user name in JS to avoid brittle implicit-relationship
// names on the untyped client.
export interface DownloadRow {
  id: string
  reportType: string
  scopeLabel: string | null
  rowCount: number | null
  filename: string | null
  userName: string
  createdAt: string
}

export async function getReportDownloads(limit = 25): Promise<DownloadRow[]> {
  const supabase = await createClient()
  const schoolId = await resolveSchoolId(supabase)
  if (!schoolId) return []

  const { data } = await supabase
    .from('report_downloads')
    .select('id, report_type, scope_label, row_count, filename, user_id, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = data || []
  const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)))
  const nameById = new Map<string, string>()
  if (userIds.length) {
    const { data: users } = await supabase.from('users').select('id, name').in('id', userIds)
    for (const u of users || []) nameById.set(u.id, u.name)
  }

  return rows.map((r: any) => ({
    id: r.id,
    reportType: r.report_type,
    scopeLabel: r.scope_label,
    rowCount: r.row_count,
    filename: r.filename,
    userName: r.user_id ? (nameById.get(r.user_id) || 'Unknown user') : 'System',
    createdAt: r.created_at,
  }))
}
