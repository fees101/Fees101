'use client'

import { useMemo, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { AuditLogRow } from '@/lib/audit/auditLog'
import { AUDIT_LOG_GROUPS, groupForAction } from '@/lib/audit/auditLogGroups'
import { actionLabel } from '@/lib/audit/auditLogLabels'

const PAGE_SIZE_OPTIONS = [50, 100, 200]

// Colour-coded pill per module — one hue each so a row's area of the app reads
// at a glance. Keys match AUDIT_LOG_GROUPS labels; classes are safelisted in
// globals.css (the JIT can't see them here). 'Other' catches anything unmapped.
const MODULE_STYLES: Record<string, string> = {
  'Staff': 'bg-blue-100 text-blue-700',
  'Roles': 'bg-indigo-100 text-indigo-700',
  'Discounts': 'bg-amber-100 text-amber-700',
  'Invoices': 'bg-sky-100 text-sky-700',
  'Students': 'bg-rose-100 text-rose-700',
  'Families': 'bg-pink-100 text-pink-700',
  'Classes & sections': 'bg-teal-100 text-teal-700',
  'Sessions & terms': 'bg-cyan-100 text-cyan-700',
  'Fee structure': 'bg-violet-100 text-violet-700',
  'Settings': 'bg-slate-100 text-slate-700',
  'Reports': 'bg-gray-100 text-gray-700',
  'Other': 'bg-gray-100 text-gray-700',
}

function getPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (currentPage <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (currentPage >= totalPages - 2) {
    return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

// Exact timestamp — used as the hover title on the relative time.
function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Relative time for at-a-glance scanning; the exact time lives in the tooltip.
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Props {
  events: AuditLogRow[]
  total: number
  page: number
  perPage: number
  group: string
  from: string
  to: string
}

// Category, date range and page are server-driven (via the URL) so they scope
// the actual query instead of just hiding rows already on the page — the log
// can hold far more history than any one page will ever fetch. The free-text
// search stays client-side, refining within whatever page is loaded.
export default function AuditLogTable({ events, total, page, perPage, group, from, to }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState('')

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({ page: String(patch.page ?? '1'), group, from, to, ...patch })
    for (const key of Array.from(params.keys())) {
      if (!params.get(key)) params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    if (!term) return events
    return events.filter((e) =>
      e.summary.toLowerCase().includes(term) ||
      e.actorName.toLowerCase().includes(term) ||
      actionLabel(e.action).toLowerCase().includes(term)
    )
  }, [events, search])

  const selectClass =
    'rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-navy focus:border-mint focus:outline-none'

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-5 flex items-center justify-between gap-4 flex-wrap border-b border-gray-100">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {total === 0 ? '0 events' : `${rangeStart}–${rangeEnd} of ${total} events`}
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={group} onChange={(e) => navigate({ group: e.target.value, page: '1' })} className={selectClass}>
            <option value="all">All types</option>
            {AUDIT_LOG_GROUPS.map((g) => (
              <option key={g.label} value={g.label}>{g.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={from}
              onChange={(e) => navigate({ from: e.target.value, page: '1' })}
              aria-label="From date"
              className={selectClass}
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="date"
              value={to}
              onChange={(e) => navigate({ to: e.target.value, page: '1' })}
              aria-label="To date"
              className={selectClass}
            />
            {(from || to) && (
              <button
                onClick={() => navigate({ from: '', to: '', page: '1' })}
                className="text-xs text-gray-400 hover:text-navy px-1"
              >
                Clear
              </button>
            )}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this page by summary or staff name"
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 w-72"
          />
        </div>
      </div>

      {total === 0 ? (
        <p className="p-5 text-sm text-gray-500">
          {group === 'all' && !from && !to
            ? 'Nothing has happened yet — actions like role changes and discount approvals will show up here.'
            : 'No events match this filter.'}
        </p>
      ) : filtered.length === 0 ? (
        <p className="p-5 text-sm text-gray-500">No events on this page match your search.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="px-5 py-3 font-medium whitespace-nowrap">When</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Who</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Action</th>
                <th className="px-5 py-3 font-medium">Details</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Module</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const module = groupForAction(e.action)
                const isSystem = e.actorName === 'System'
                return (
                  <tr key={e.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-5 py-3.5 align-top text-gray-500 whitespace-nowrap" title={formatWhen(e.createdAt)}>
                      {timeAgo(e.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 align-top whitespace-nowrap">
                      {isSystem ? (
                        <span className="inline-flex items-center gap-1.5 text-gray-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                          Automated
                        </span>
                      ) : (
                        <span className="text-navy">{e.actorName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 align-top text-navy font-medium whitespace-nowrap">{actionLabel(e.action)}</td>
                    <td className="px-5 py-3.5 align-top text-gray-600">{e.summary}</td>
                    <td className="px-5 py-3.5 align-top whitespace-nowrap">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${MODULE_STYLES[module] || MODULE_STYLES['Other']}`}>
                        {module}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              Showing {rangeStart}-{rangeEnd} of {total} events
            </span>
            <label className="flex items-center gap-1.5 text-sm text-gray-500">
              Per page
              <select
                value={perPage}
                onChange={(e) => navigate({ perPage: e.target.value, page: '1' })}
                className={selectClass}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate({ page: String(page - 1) })}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-navy disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            {getPageNumbers(page, totalPages).map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-sm text-gray-400">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => navigate({ page: String(p) })}
                  className={`min-w-[2.25rem] px-2.5 py-1.5 rounded-lg text-sm ${
                    p === page ? 'bg-navy text-white font-medium' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => navigate({ page: String(page + 1) })}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-navy disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
