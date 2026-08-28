'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { ActivityRow } from '@/lib/queries/activity'
import { ACTIVITY_CATEGORIES, ACTIVITY_PAGE_SIZE_OPTIONS } from '@/lib/activity/activityMeta'

interface Props {
  rows: ActivityRow[]
  total: number
  page: number
  perPage: number
  category: string
  from: string
  to: string
  search: string
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function timeAgo(iso: string): string {
  const then = new Date(iso)
  const diffMs = Date.now() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatExact(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function getPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (currentPage <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (currentPage >= totalPages - 2) return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

// Dot colour + icon per category — mirrors the dashboard's mini feed.
function categoryVisual(category: string): { dot: string; icon: React.ReactNode } {
  switch (category) {
    case 'payments':
      return {
        dot: 'bg-emerald-500',
        icon: <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0"><span className="text-emerald-700 font-bold text-sm">₦</span></div>,
      }
    case 'invoices':
      return {
        dot: 'bg-blue-500',
        icon: <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-blue-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></div>,
      }
    case 'messages':
      return {
        dot: 'bg-purple-500',
        icon: <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-purple-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg></div>,
      }
    case 'discounts':
      return {
        dot: 'bg-amber-500',
        icon: <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-amber-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg></div>,
      }
    default: // students
      return {
        dot: 'bg-rose-500',
        icon: <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-rose-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></div>,
      }
  }
}

// Coloured module badge per category — mirrors the reference table's pills.
function categoryBadge(category: string): { label: string; className: string } {
  switch (category) {
    case 'payments': return { label: 'Payments', className: 'bg-emerald-100 text-emerald-700' }
    case 'invoices': return { label: 'Invoices', className: 'bg-blue-100 text-blue-700' }
    case 'messages': return { label: 'Messages', className: 'bg-purple-100 text-purple-700' }
    case 'discounts': return { label: 'Discounts', className: 'bg-amber-100 text-amber-700' }
    default: return { label: 'Students', className: 'bg-rose-100 text-rose-700' }
  }
}

// Rolling-window presets — clicking sets `from` (and clears `to`) so the query
// re-scopes server-side across the whole history, not just the loaded page.
const WINDOW_PRESETS = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 3 months', days: 90 },
  { label: 'Last 12 months', days: 365 },
]

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function ActivityFeed({ rows, total, page, perPage, category, from, to, search }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [searchInput, setSearchInput] = useState(search)

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({ page: '1', category, from, to, search, ...patch })
    for (const key of Array.from(params.keys())) {
      if (!params.get(key) || params.get(key) === 'all') params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  // Debounce the student-name search into the URL (server-side filter).
  useEffect(() => {
    if (searchInput === search) return
    const t = setTimeout(() => navigate({ search: searchInput, page: '1' }), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  // Keep the box in sync when the URL changes from elsewhere (back/forward, Clear).
  useEffect(() => { setSearchInput(search) }, [search])

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  const selectClass = 'rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-navy focus:border-mint focus:outline-none'
  const activeWindow = from && !to ? WINDOW_PRESETS.find((w) => isoDaysAgo(w.days) === from)?.days : undefined

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Category chips */}
      <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
        {ACTIVITY_CATEGORIES.map((c) => {
          const active = (category || 'all') === c.key
          return (
            <button
              key={c.key}
              onClick={() => navigate({ category: c.key, page: '1' })}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active ? 'bg-navy text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {/* Filters row: rolling windows, custom range, search */}
      <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {WINDOW_PRESETS.map((w) => (
            <button
              key={w.days}
              onClick={() => navigate({ from: isoDaysAgo(w.days), to: '', page: '1' })}
              className={`px-2.5 py-1.5 rounded-lg text-sm border transition-colors ${
                activeWindow === w.days ? 'border-mint bg-mint-light text-navy font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {w.label}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-1">
            <input type="date" value={from} onChange={(e) => navigate({ from: e.target.value, page: '1' })} aria-label="From date" className={selectClass} />
            <span className="text-gray-400 text-sm">–</span>
            <input type="date" value={to} onChange={(e) => navigate({ to: e.target.value, page: '1' })} aria-label="To date" className={selectClass} />
            {(from || to) && (
              <button onClick={() => navigate({ from: '', to: '', page: '1' })} className="text-xs text-gray-400 hover:text-navy px-1">Clear</button>
            )}
          </div>
        </div>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by student name"
          className="px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 w-64"
        />
      </div>

      {/* Feed table */}
      {total === 0 ? (
        <p className="p-6 text-sm text-gray-500">
          {category === 'all' && !from && !to && !search
            ? 'No activity yet — payments, invoices, messages and discounts will appear here as they happen.'
            : 'No activity matches these filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3 font-medium whitespace-nowrap">Time</th>
                <th className="px-5 py-3 font-medium">Activity</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => {
                const { icon } = categoryVisual(event.category)
                const badge = categoryBadge(event.category)
                return (
                  <tr key={event.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-5 py-3.5 align-top whitespace-nowrap text-gray-500" title={formatExact(event.occurredAt)}>
                      {timeAgo(event.occurredAt)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-start gap-3">
                        {icon}
                        <div className="min-w-0">
                          <p className="text-navy font-medium leading-snug">{event.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5 leading-snug">{event.subtitle}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 align-top">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${badge.className}`}>{badge.label}</span>
                    </td>
                    <td className="px-5 py-3.5 align-top text-right whitespace-nowrap">
                      {event.amount !== null
                        ? <span className="text-navy font-semibold">{formatNaira(event.amount)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">Showing {rangeStart}–{rangeEnd} of {total} events</span>
            <label className="flex items-center gap-1.5 text-sm text-gray-500">
              Per page
              <select value={perPage} onChange={(e) => navigate({ perPage: e.target.value, page: '1' })} className={selectClass}>
                {ACTIVITY_PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate({ page: String(page - 1) })} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-navy disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50">Previous</button>
            {getPageNumbers(page, totalPages).map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-sm text-gray-400">...</span>
              ) : (
                <button key={p} onClick={() => navigate({ page: String(p) })} className={`min-w-[2.25rem] px-2.5 py-1.5 rounded-lg text-sm ${p === page ? 'bg-navy text-white font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>{p}</button>
              )
            )}
            <button onClick={() => navigate({ page: String(page + 1) })} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-navy disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
