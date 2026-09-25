'use client'

import { useMemo, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { ScopeSession, ScopeCycle, DownloadRow } from '@/lib/reports/reports'
import ExportCsvButton from './ExportCsvButton'
import { formatDate, formatDateTime } from '@/lib/format/date'

// ---------------------------------------------------------------------------
// Reports and exports (App Shell "money:2", paper ground). Two in-page views
// switched by a local tab strip — client state, not a route, same pattern
// PaymentsDashboard uses for Position/Breakdown/Forecast underneath the
// Money workspace's own Invoices/Collections/Reports route tabs: "Reports"
// (the exports ledger, one row per report with an inline scope panel to
// download) and "History" (the cross-report download log, paginated since it
// only ever grows).
// ---------------------------------------------------------------------------

interface Props {
  sessions: ScopeSession[]
  cycles: ScopeCycle[]
  // Small, unfiltered — just enough to find each report's most recent run.
  recentDownloads: DownloadRow[]
  // The History tab's current page, already filtered and paginated server-side.
  history: DownloadRow[]
  historyTotal: number
  page: number
  perPage: number
  reportType: string
  // When false, the money-bearing reports are hidden (user lacks see-financial-totals).
  showFinancials: boolean
  // Independent gates: a user can have one without the other (e.g. an
  // auditor role with see-audit-log but not see-reports).
  showReports: boolean
  showAuditLog: boolean
}

type ScopeKind = 'cycle' | 'dates' | 'status' | 'none'
type ViewMode = 'reports' | 'history'

interface ReportDef {
  type: string
  title: string
  grain: string
  description: string
  scope: ScopeKind
  // True for reports whose columns are financial — hidden without see-financial-totals.
  financial?: boolean
}

const REPORTS: ReportDef[] = [
  { type: 'debtors',       title: 'Debtors / outstanding', grain: 'per student who owes', description: 'Everyone with a balance — parent, phone, billed, paid, outstanding.', scope: 'cycle',  financial: true },
  { type: 'collections',   title: 'Collections',           grain: 'per payment',          description: 'Every payment received — date, student, amount, method, sender.',      scope: 'dates',  financial: true },
  { type: 'class-summary', title: 'Per-class summary',     grain: 'per class',            description: 'Billed, collected, outstanding and collection rate by class.',          scope: 'cycle',  financial: true },
  { type: 'invoices',      title: 'Invoices',              grain: 'per invoice',          description: 'Raw billing ledger — subtotal, discount, total, paid, outstanding.',    scope: 'cycle',  financial: true },
  { type: 'discounts',     title: 'Discounts',             grain: 'per discount',         description: 'Every discount — category, value, status, recurring, reason.',          scope: 'cycle',  financial: true },
  { type: 'unresolved-credits', title: 'Unresolved credits', grain: 'per opt-out overage', description: 'Amounts left as-is for a manual refund outside the app — open and resolved.', scope: 'none', financial: true },
  { type: 'students',      title: 'Student directory',     grain: 'per student',          description: 'Full student list with class, contact, virtual account, credit.',       scope: 'status' },
  { type: 'audit-log',     title: 'Audit log',             grain: 'per event',            description: 'Every action logged in this account — who did what and when.',          scope: 'dates' },
]

const REPORT_TITLES: Record<string, string> = Object.fromEntries(REPORTS.map(r => [r.type, r.title]))

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active only' },
  { value: 'withdrawn', label: 'Withdrawn only' },
  { value: 'graduated', label: 'Graduated only' },
  { value: 'suspended', label: 'Suspended only' },
  { value: 'all', label: 'All statuses' },
]

// Paper-ground exports table grid — shared by the header and every row so the
// four columns line up. Inline, not a Tailwind class, because the WASM build
// drops arbitrary multi-minmax grid templates.
const GRID = 'minmax(0,2fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)'

const HISTORY_PAGE_SIZES = [25, 50, 100]

// "Today" for a same-day run, "14 Mar" within this year, else the full date.
function lastRunLabel(iso: string | undefined): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Never'
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const full = formatDate(iso)
  return d.getFullYear() === now.getFullYear() ? full.replace(` ${d.getFullYear()}`, '') : full
}

export default function ReportsLayout({
  sessions, cycles, recentDownloads, history, historyTotal, page, perPage, reportType,
  showFinancials, showReports, showAuditLog,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [mode, setMode] = useState<ViewMode>('reports')
  const [openType, setOpenType] = useState<string | null>(null)

  const visibleReports = useMemo(() => {
    let list = REPORTS.filter(r => r.type !== 'audit-log')
    if (!showReports) list = []
    if (!showFinancials) list = list.filter(r => !r.financial)
    if (showAuditLog) list = [...list, REPORTS.find(r => r.type === 'audit-log')!]
    return list
  }, [showFinancials, showReports, showAuditLog])

  // Most recent download per report type — feeds COVERS (last run's row count)
  // and LAST RUN. recentDownloads arrive newest-first, so the first match wins.
  const lastByType = useMemo(() => {
    const m = new Map<string, DownloadRow>()
    for (const d of recentDownloads) if (!m.has(d.reportType)) m.set(d.reportType, d)
    return m
  }, [recentDownloads])

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage), reportType, ...patch })
    for (const key of Array.from(params.keys())) {
      const v = params.get(key)
      // Drop defaults so the URL stays clean.
      if (!v || (key === 'reportType' && v === 'all') || (key === 'perPage' && v === '25') || (key === 'page' && v === '1')) params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  const totalPages = Math.max(1, Math.ceil(historyTotal / perPage))
  const rangeStart = historyTotal === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, historyTotal)

  return (
    <div>
      {/* View switch — Export / History, client state under the Money
          workspace's own route tabs. Deliberately not called "Reports" a
          second time — the workspace route tab right above already says
          that, and two tabs with the same label reads as a bug, not a
          sub-view. */}
      <div className="flex items-center gap-6 mb-7" style={{ borderBottom: '2px solid var(--color-ink)' }}>
        <button
          type="button"
          onClick={() => setMode('reports')}
          data-active={mode === 'reports'}
          aria-current={mode === 'reports' ? 'page' : undefined}
          className="m-tab -mb-[2px]"
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => setMode('history')}
          data-active={mode === 'history'}
          aria-current={mode === 'history' ? 'page' : undefined}
          className="m-tab -mb-[2px]"
        >
          History
        </button>
      </div>

      {mode === 'reports' ? (
        <div className="m-anim-fade">
          <div className="flex flex-wrap items-end justify-between gap-5 mb-4">
            <div>
              <h2 className="text-[25px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)] mb-1">Reports and exports</h2>
              <p className="text-sm text-[var(--color-neutral-800)] max-w-[68ch]">
                Exports are an action on data you can already see, not a separate reporting tool. Every
                table in the product exports what is on screen, with the filters you applied.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            {/* Column header */}
            <div
              className="grid gap-3.5 pb-2"
              style={{ gridTemplateColumns: GRID, minWidth: 560, borderBottom: '2px solid var(--color-ink)' }}
            >
              <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">REPORT</span>
              <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">COVERS</span>
              <span className="text-right text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">LAST RUN</span>
              <span className="text-right text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]" />
            </div>

            {visibleReports.length === 0 ? (
              <p className="py-12 text-sm text-[var(--color-neutral-700)]">No reports available to you.</p>
            ) : (
              visibleReports.map(def => {
                const last = lastByType.get(def.type)
                const covers = last?.rowCount != null ? `${last.rowCount.toLocaleString()} rows` : `one row ${def.grain}`
                const open = openType === def.type
                return (
                  <div key={def.type} style={{ borderBottom: '1px solid var(--color-neutral-300)' }}>
                    <div
                      onClick={() => setOpenType(open ? null : def.type)}
                      className="grid gap-3.5 items-baseline cursor-pointer"
                      style={{ gridTemplateColumns: GRID, minWidth: 560, padding: '12px 0' }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <p className="text-sm font-semibold text-[var(--color-ink)]">{def.title}</p>
                        <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">{def.description}</p>
                      </div>
                      <span className="text-[13px] m-num text-[var(--color-neutral-800)]">{covers}</span>
                      <span className="text-right text-sm m-num" style={{ color: last ? 'var(--color-neutral-800)' : 'var(--color-neutral-600)' }}>
                        {lastRunLabel(last?.createdAt)}
                      </span>
                      <span className="text-right text-[12px] font-semibold tracking-[0.08em] text-[var(--color-ink)]">
                        {open ? 'CLOSE' : 'EXPORT'}
                      </span>
                    </div>

                    {open && (
                      <ScopePanel def={def} sessions={sessions} cycles={cycles} />
                    )}
                  </div>
                )
              })
            )}
          </div>

          <p className="text-sm font-semibold mt-4" style={{ color: 'var(--color-ochre-text)' }}>
            Anything exported is logged against your name — exports carry parent phone numbers.
          </p>
        </div>
      ) : (
        <div className="m-anim-fade">
          <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b-2 border-[var(--color-ink)]">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)]">Download history</h2>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-neutral-700)]">Show</span>
              <select
                value={reportType}
                onChange={e => navigate({ reportType: e.target.value, page: '1' })}
                className="m-select w-auto"
              >
                <option value="all">All reports</option>
                {visibleReports.map(r => <option key={r.type} value={r.type}>{r.title}</option>)}
              </select>
            </label>
          </div>

          {history.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-neutral-700)]">
              {historyTotal === 0 && reportType === 'all' ? 'No reports downloaded yet.' : 'No downloads for this report yet.'}
            </p>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="m-table min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Report</th>
                      <th>Scope</th>
                      <th className="text-right">Rows</th>
                      <th>By</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(d => (
                      <tr key={d.id}>
                        <td className="font-medium text-[var(--color-ink)]">{REPORT_TITLES[d.reportType] || d.reportType}</td>
                        <td className="text-[var(--color-neutral-700)]">{d.scopeLabel || '—'}</td>
                        <td className="text-right text-[var(--color-neutral-700)] m-num">{d.rowCount ?? '—'}</td>
                        <td className="text-[var(--color-neutral-700)]">{d.userName}</td>
                        <td className="text-[var(--color-neutral-700)] whitespace-nowrap m-num">{formatDateTime(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5">
                <span className="m-num text-[13px] text-[var(--color-neutral-700)]">
                  Showing {rangeStart}–{rangeEnd} of {historyTotal}
                </span>
                <div className="flex flex-wrap items-center gap-5">
                  <label className="flex items-center gap-2 text-[13px] text-[var(--color-neutral-700)]">
                    <span className="hidden sm:inline">Show</span>
                    <span className="flex items-center gap-2.5">
                      {HISTORY_PAGE_SIZES.map(n => (
                        <button
                          key={n}
                          onClick={() => navigate({ perPage: String(n), page: '1' })}
                          className="m-num"
                          style={{
                            background: 'none', border: 0, padding: 0, cursor: 'pointer',
                            fontWeight: perPage === n ? 700 : 400,
                            color: perPage === n ? 'var(--color-ink)' : 'var(--color-neutral-700)',
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => navigate({ page: String(page - 1) })}
                      disabled={page <= 1}
                      className="px-2 py-2 text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:hover:text-[var(--color-neutral-700)]"
                    >
                      ← Newer
                    </button>
                    <span className="m-num px-1.5 text-[13px]">{page} / {totalPages}</span>
                    <button
                      onClick={() => navigate({ page: String(page + 1) })}
                      disabled={page >= totalPages}
                      className="px-2 py-2 text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:hover:text-[var(--color-neutral-700)]"
                    >
                      Older →
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// The scope selector + download action for one report, opened inline under its
// row. Holds its own scope state (term/session, date range, or status) exactly
// as the underlying data allows, then hands the resolved params to the export.
function ScopePanel({ def, sessions, cycles }: { def: ReportDef; sessions: ScopeSession[]; cycles: ScopeCycle[] }) {
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
    if (def.scope === 'none') return {}
    return { status }
  }, [def, cycleScope, from, to, status])

  return (
    <div className="pb-4 -mt-0.5" style={{ maxWidth: 560 }}>
      <div className="flex flex-wrap items-end gap-3 bg-[var(--color-surface)] p-3">
        <div className="flex-1 min-w-[220px]">
          <span className="m-label">Scope</span>
          {def.scope === 'cycle' && (
            <select value={cycleScope} onChange={e => setCycleScope(e.target.value)} className="m-select">
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
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="m-input" aria-label="From" />
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="m-input" aria-label="To" />
            </div>
          )}

          {def.scope === 'status' && (
            <select value={status} onChange={e => setStatus(e.target.value)} className="m-select">
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}

          {def.scope === 'none' && (
            <p className="text-xs text-[var(--color-neutral-700)]">Exports the full list — no scope to set.</p>
          )}
        </div>
        <ExportCsvButton type={def.type} params={params} label="Download CSV" variant="primary" />
      </div>
    </div>
  )
}
