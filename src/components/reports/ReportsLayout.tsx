'use client'

import { useMemo, useState } from 'react'
import type { ScopeSession, ScopeCycle, DownloadRow } from '@/lib/reports/reports'
import ExportCsvButton from './ExportCsvButton'

// ---------------------------------------------------------------------------
// Reports page. A compact card per report (pick scope → download) plus a single
// filterable download history / audit trail below.
//
// One shared history (filterable by report type) rather than per-card history:
// it keeps the cards small and preserves the cross-report view ("what did we
// pull, and who pulled it?"), while still letting you narrow to one report.
//
// Scoping, matched to the underlying data:
//   • cycle-scoped reports → single term / whole session / all history
//   • collections          → payment date range
//   • student directory     → student status
// ---------------------------------------------------------------------------

interface Props {
  sessions: ScopeSession[]
  cycles: ScopeCycle[]
  downloads: DownloadRow[]
  // When false, the money-bearing reports are hidden (user lacks see-financial-totals).
  showFinancials: boolean
  // Independent gates: a user can have one without the other (e.g. an
  // auditor role with see-audit-log but not see-reports).
  showReports: boolean
  showAuditLog: boolean
}

type ScopeKind = 'cycle' | 'dates' | 'status'
type Accent = 'red' | 'mint' | 'amber' | 'navy' | 'violet' | 'gray'

interface ReportDef {
  type: string
  title: string
  grain: string
  description: string
  scope: ScopeKind
  accent: Accent
  icon: string
  // True for reports whose columns are financial — hidden without see-financial-totals.
  financial?: boolean
}

// Heroicons (outline) single-path glyphs.
const ICONS = {
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14',
  cash: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m3 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H10a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  doc: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  tag: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  users: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  log: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
}

const ACCENT: Record<Accent, string> = {
  red:    'bg-red-50 text-red-500',
  mint:   'bg-mint/10 text-mint',
  amber:  'bg-amber-50 text-amber-500',
  navy:   'bg-navy/5 text-navy',
  violet: 'bg-violet-50 text-violet-500',
  gray:   'bg-gray-100 text-gray-500',
}

const REPORTS: ReportDef[] = [
  { type: 'debtors',       title: 'Debtors / outstanding', grain: 'per student who owes', description: 'Everyone with a balance — parent, phone, billed, paid, outstanding.', scope: 'cycle',  accent: 'red',    icon: ICONS.chart, financial: true },
  { type: 'collections',   title: 'Collections',           grain: 'per payment',          description: 'Every payment received — date, student, amount, method, sender.',      scope: 'dates',  accent: 'mint',   icon: ICONS.cash, financial: true },
  { type: 'class-summary', title: 'Per-class summary',     grain: 'per class',            description: 'Billed, collected, outstanding and collection rate by class.',          scope: 'cycle',  accent: 'amber',  icon: ICONS.chart, financial: true },
  { type: 'invoices',      title: 'Invoices',              grain: 'per invoice',          description: 'Raw billing ledger — subtotal, discount, total, paid, outstanding.',    scope: 'cycle',  accent: 'navy',   icon: ICONS.doc, financial: true },
  { type: 'discounts',     title: 'Discounts',             grain: 'per discount',         description: 'Every discount — category, value, status, recurring, reason.',          scope: 'cycle',  accent: 'violet', icon: ICONS.tag, financial: true },
  { type: 'students',      title: 'Student directory',     grain: 'per student',          description: 'Full student list with class, contact, virtual account, credit.',       scope: 'status', accent: 'gray',   icon: ICONS.users },
  { type: 'audit-log',     title: 'Audit log',             grain: 'per event',            description: 'Every action logged in this account — who did what and when.',          scope: 'dates',  accent: 'navy',   icon: ICONS.log },
]

const REPORT_TITLES: Record<string, string> = Object.fromEntries(REPORTS.map(r => [r.type, r.title]))

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active only' },
  { value: 'withdrawn', label: 'Withdrawn only' },
  { value: 'graduated', label: 'Graduated only' },
  { value: 'suspended', label: 'Suspended only' },
  { value: 'all', label: 'All statuses' },
]

const selectClass = 'mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-navy focus:border-mint focus:outline-none'

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ReportsLayout({ sessions, cycles, downloads, showFinancials, showReports, showAuditLog }: Props) {
  const [historyFilter, setHistoryFilter] = useState('all')

  const visibleReports = useMemo(() => {
    let list = REPORTS.filter(r => r.type !== 'audit-log')
    if (!showReports) list = []
    if (!showFinancials) list = list.filter(r => !r.financial)
    if (showAuditLog) list = [...list, REPORTS.find(r => r.type === 'audit-log')!]
    return list
  }, [showFinancials, showReports, showAuditLog])

  const visibleDownloads = useMemo(
    () => historyFilter === 'all' ? downloads : downloads.filter(d => d.reportType === historyFilter),
    [downloads, historyFilter],
  )

  return (
    <div>
      <h1 className="text-3xl font-bold text-navy">Reports</h1>
      <p className="mt-2 text-gray-500">
        Download your data as CSV — opens in Excel or Google Sheets. Pick a report and its scope,
        then download. Every download is recorded in the history below.
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleReports.map(r => (
          <ReportCard key={r.type} def={r} sessions={sessions} cycles={cycles} />
        ))}
      </div>

      {/* Download history / audit trail */}
      <div className="mt-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Download history</h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Show</span>
            <select
              value={historyFilter}
              onChange={e => setHistoryFilter(e.target.value)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-navy focus:border-mint focus:outline-none"
            >
              <option value="all">All reports</option>
              {visibleReports.map(r => <option key={r.type} value={r.type}>{r.title}</option>)}
            </select>
          </label>
        </div>

        {visibleDownloads.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {downloads.length === 0 ? 'No reports downloaded yet.' : 'No downloads for this report yet.'}
          </p>
        ) : (
          <div className="mt-3 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-5 py-3 font-medium">Report</th>
                  <th className="px-5 py-3 font-medium">Scope</th>
                  <th className="px-5 py-3 font-medium text-right">Rows</th>
                  <th className="px-5 py-3 font-medium">By</th>
                  <th className="px-5 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {visibleDownloads.map(d => (
                  <tr key={d.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-3 font-medium text-navy">{REPORT_TITLES[d.reportType] || d.reportType}</td>
                    <td className="px-5 py-3 text-gray-600">{d.scopeLabel || '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">{d.rowCount ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">{d.userName}</td>
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{formatWhen(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ReportCard({ def, sessions, cycles }: { def: ReportDef; sessions: ScopeSession[]; cycles: ScopeCycle[] }) {
  const [cycleScope, setCycleScope] = useState('all')   // 'all' | 'session:<id>' | 'cycle:<id>'
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('active')

  const params = useMemo(() => {
    if (def.scope === 'cycle') {
      if (cycleScope.startsWith('session:')) return { sessionId: cycleScope.slice(8) }
      if (cycleScope.startsWith('cycle:')) return { cycleId: cycleScope.slice(6) }
      return {}
    }
    if (def.scope === 'dates') return { from, to }
    return { status }
  }, [def, cycleScope, from, to, status])

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-col hover:border-gray-300 hover:shadow-sm transition-all">
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${ACCENT[def.accent]}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d={def.icon} />
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-navy text-sm leading-tight truncate">{def.title}</h3>
          <span className="text-[10px] text-gray-400">one row {def.grain}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-2.5 flex-1">{def.description}</p>

      <div className="mt-3">
        {def.scope === 'cycle' && (
          <select value={cycleScope} onChange={e => setCycleScope(e.target.value)} className={selectClass}>
            <option value="all">All history</option>
            {sessions.length > 0 && (
              <optgroup label="Whole session">
                {sessions.map(s => <option key={s.id} value={`session:${s.id}`}>{s.name}</option>)}
              </optgroup>
            )}
            {cycles.length > 0 && (
              <optgroup label="Single term">
                {cycles.map(c => <option key={c.id} value={`cycle:${c.id}`}>{c.name}</option>)}
              </optgroup>
            )}
          </select>
        )}

        {def.scope === 'dates' && (
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selectClass} aria-label="From" />
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={selectClass} aria-label="To" />
          </div>
        )}

        {def.scope === 'status' && (
          <select value={status} onChange={e => setStatus(e.target.value)} className={selectClass}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>

      <div className="mt-3">
        <ExportCsvButton type={def.type} params={params} label="Download CSV" variant="primary" block className="w-full" />
      </div>
    </div>
  )
}
