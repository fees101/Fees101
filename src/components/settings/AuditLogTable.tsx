'use client'

import { useMemo, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { AuditLogRow } from '@/lib/audit/auditLog'
import { AUDIT_LOG_GROUPS, groupForAction } from '@/lib/audit/auditLogGroups'
import { actionLabel } from '@/lib/audit/auditLogLabels'
import { formatDate, formatDateTime } from '@/lib/format/date'

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

function getPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (currentPage <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (currentPage >= totalPages - 2) {
    return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
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
  return formatDate(iso)
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

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  return (
    <div>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Audit log
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          Every staff action that changed money, access or a student record. Payments and messages live in Today →
          Record; this is the trail for who did what.
        </p>
      </div>

      <div className="pt-6 pb-4 mb-4 border-b border-[var(--color-neutral-300)] flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-700)]">
          {total === 0 ? '0 events' : <>{rangeStart}-{rangeEnd} of <span className="m-num">{total}</span> events</>}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={group} onChange={(e) => navigate({ group: e.target.value, page: '1' })} className="m-select w-auto min-h-0 py-1.5">
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
              className="m-input w-auto min-h-0 py-1.5"
            />
            <span className="text-[var(--color-neutral-500)] text-sm">-</span>
            <input
              type="date"
              value={to}
              onChange={(e) => navigate({ to: e.target.value, page: '1' })}
              aria-label="To date"
              className="m-input w-auto min-h-0 py-1.5"
            />
            {(from || to) && (
              <button
                onClick={() => navigate({ from: '', to: '', page: '1' })}
                className="text-xs text-[var(--color-neutral-500)] hover:text-[var(--color-ink)] px-1"
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
            className="m-input min-h-0 py-1.5 w-72"
          />
        </div>
      </div>

      {total === 0 ? (
        <p className="text-sm text-[var(--color-neutral-700)] text-center py-16">
          {group === 'all' && !from && !to
            ? 'Nothing has happened yet — actions like role changes and discount approvals will show up here.'
            : 'No events match this filter.'}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--color-neutral-700)] text-center py-16">No events on this page match your search.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="m-table">
            <thead>
              <tr>
                <th className="whitespace-nowrap">When</th>
                <th className="whitespace-nowrap">Who</th>
                <th className="whitespace-nowrap">Action</th>
                <th>Details</th>
                <th className="whitespace-nowrap text-right">Module</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const module = groupForAction(e.action)
                const isSystem = e.actorName === 'System'
                return (
                  <tr key={e.id}>
                    <td className="align-top text-[var(--color-neutral-700)] whitespace-nowrap m-num" title={formatDateTime(e.createdAt)}>
                      {timeAgo(e.createdAt)}
                    </td>
                    <td className="align-top whitespace-nowrap">
                      {isSystem ? (
                        <span className="inline-flex items-center gap-1.5 text-[var(--color-neutral-700)]">
                          <span aria-hidden className="w-1.5 h-1.5 bg-[var(--color-neutral-400)]" />
                          Automated
                        </span>
                      ) : (
                        <span className="text-[var(--color-ink)]">{e.actorName}</span>
                      )}
                    </td>
                    <td className="align-top text-[var(--color-ink)] font-semibold whitespace-nowrap">{actionLabel(e.action)}</td>
                    <td className="align-top text-[var(--color-neutral-700)]">{e.summary}</td>
                    <td className="align-top whitespace-nowrap text-right">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-500)]">{module}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="pt-4 mt-1 border-t border-[var(--color-neutral-300)] flex flex-col sm:flex-row items-center gap-3 justify-between text-sm">
          <div className="flex items-center gap-4">
            <p className="text-[var(--color-neutral-700)]">
              Showing <span className="m-num">{rangeStart}-{rangeEnd}</span> of <span className="m-num">{total}</span> events
            </p>
            <label className="flex items-center gap-2 text-[var(--color-neutral-700)]">
              <span className="hidden sm:inline">Show</span>
              <span className="flex items-center gap-2.5">
                {PAGE_SIZE_OPTIONS.map((n) => (
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
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate({ page: String(page - 1) })}
              disabled={page <= 1}
              className="m-btn m-btn-sm hover:bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>
            {getPageNumbers(page, totalPages).map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-[var(--color-neutral-500)]">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => navigate({ page: String(p) })}
                  className={`min-w-[32px] px-2 py-1 text-sm m-num ${
                    p === page ? 'bg-[var(--color-ink)] text-[var(--color-paper)] font-semibold' : 'text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => navigate({ page: String(page + 1) })}
              disabled={page >= totalPages}
              className="m-btn m-btn-sm hover:bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
