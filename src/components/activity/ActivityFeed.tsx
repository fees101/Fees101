'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { ActivityRow, ActivityAggregate } from '@/lib/queries/activity'
import { ACTIVITY_CATEGORIES, ACTIVITY_PAGE_SIZE_OPTIONS, type ActivityCategory } from '@/lib/activity/activityMeta'
import { formatDateTime } from '@/lib/format/date'
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'
import { exportActivityCsv } from '@/app/(app)/today/record/actions'

type Range = '7' | 'term' | 'all'

interface Props {
  rows: ActivityRow[]
  total: number
  page: number
  perPage: number
  category: string
  range: Range
  search: string
  schoolId: string
  aggregate: ActivityAggregate
  termFrom: string
  // When false (no see-financial-totals), the hero total redacts to "—" —
  // same convention as the dashboard hero and Cycles' billed/collected. Row
  // amounts are already redacted at the source (null, rendered as "—").
  showFinancials: boolean
}

// The school operates on Lagos time; pin every clock/day bucket to it so the
// server render and the client hydration agree (no timezone drift) and the day
// groups match the school's own calendar rather than the browser's.
const TZ = 'Africa/Lagos'

// The five columns of the Record table, shared by the header and every row so
// they line up. Inline (not a Tailwind class) because the WASM build doesn't
// emit arbitrary multi-minmax grid templates.
const GRID_COLS = 'minmax(60px,0.5fr) minmax(150px,1.6fr) minmax(190px,2.2fr) minmax(96px,1fr) minmax(110px,1.1fr)'

function formatNaira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ })
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function dayLabel(iso: string, todayKey: string, yesterdayKey: string): string {
  const key = dayKey(iso)
  const full = new Date(iso)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: TZ })
    .toUpperCase()
  if (key === todayKey) return 'TODAY'
  if (key === yesterdayKey) return `YESTERDAY · ${full}`
  return full
}

// App Shell category labels: uppercase and singular where it reads better.
const CAT_LABEL: Record<ActivityCategory, string> = {
  payments: 'PAYMENT',
  invoices: 'INVOICE',
  messages: 'MESSAGE',
  discounts: 'DISCOUNT',
  students: 'STUDENTS',
}

// Colour carries meaning, App-Shell style: ledger green only where money
// actually arrived, ochre for the invoice/discount decisions a human drove,
// muted neutral for everything informational. No coloured pills.
function categoryColor(row: ActivityRow): string {
  const received = row.eventType === 'payment_received'
  if (row.category === 'payments') return received ? 'var(--color-ledger)' : 'var(--color-neutral-700)'
  if (row.category === 'invoices' || row.category === 'discounts') return 'var(--color-ochre-text)'
  return 'var(--color-neutral-700)'
}

export default function ActivityFeed({
  rows, total, page, perPage, category, range, search, schoolId, aggregate, termFrom, showFinancials,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  // activity_feed is a VIEW; Realtime only replays base-table changes, so this
  // subscribes to every table the view unions (see db/enable_realtime.sql and
  // db/activity_feed_add_missing_events.sql).
  useRealtimeRefresh([
    { table: 'payments', filter: `school_id=eq.${schoolId}` },
    { table: 'invoices', filter: `school_id=eq.${schoolId}` },
    { table: 'discounts', filter: `school_id=eq.${schoolId}` },
    { table: 'message_logs', filter: `school_id=eq.${schoolId}` },
    { table: 'students', filter: `school_id=eq.${schoolId}` },
    { table: 'audit_log', filter: `school_id=eq.${schoolId}` },
  ])
  const [searchInput, setSearchInput] = useState(search)
  const [exporting, setExporting] = useState(false)

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({ page: '1', perPage: String(perPage), category, range, search, ...patch })
    for (const key of Array.from(params.keys())) {
      const v = params.get(key)
      // Drop defaults so the URL stays clean: category "all", range "7", empties.
      if (!v || (key === 'category' && v === 'all') || (key === 'range' && v === '7') || (key === 'perPage' && v === '50')) params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  // Debounce the name search into the URL (server-side filter).
  useEffect(() => {
    if (searchInput === search) return
    const t = setTimeout(() => navigate({ search: searchInput, page: '1' }), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])
  useEffect(() => { setSearchInput(search) }, [search])

  const effectiveFrom = range === 'all' ? undefined : range === 'term' ? termFrom || undefined : isoDaysAgo(7)

  async function handleExport() {
    setExporting(true)
    try {
      const res = await exportActivityCsv({ category, from: effectiveFrom, search })
      if ('error' in res) return
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  const rangeLabel = range === 'all'
    ? 'All time'
    : range === 'term'
      ? (termFrom ? `Since ${fmtShort(`${termFrom}T00:00:00`)}` : 'This term')
      : `${fmtShort(`${isoDaysAgo(7)}T00:00:00`)} – ${fmtShort(new Date().toISOString())}`

  // Group the page's rows into calendar days (school time).
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const yesterdayKey = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: TZ })
  type Group = { key: string; label: string; events: number; received: number; rows: ActivityRow[] }
  const groups: Group[] = []
  for (const r of rows) {
    const k = dayKey(r.occurredAt)
    let g = groups[groups.length - 1]
    if (!g || g.key !== k) {
      g = { key: k, label: dayLabel(r.occurredAt, todayKey, yesterdayKey), events: 0, received: 0, rows: [] }
      groups.push(g)
    }
    g.rows.push(r)
    g.events += 1
    if (r.eventType === 'payment_received' && r.amount) g.received += r.amount
  }

  const presetBtn = (value: Range, label: string, disabled = false) => (
    <button
      onClick={() => !disabled && navigate({ range: value, page: '1' })}
      disabled={disabled}
      className={`px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40 ${value !== '7' ? 'border-l-2 border-[var(--color-ink)]' : ''} ${
        range === value ? 'bg-[var(--color-ink)] text-[var(--color-paper)]' : 'text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <>
      <div className="m-panel">
      {/* Hero: money received in range + the range controls. */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-neutral-700)]">Received in range</p>
          <p className="m-num text-[40px] font-extrabold leading-[0.92] tracking-[-0.03em] text-[var(--color-ledger)]">{showFinancials ? formatNaira(aggregate.receivedInRange) : '—'}</p>
          <p className="m-num mt-1.5 text-[13px] text-[var(--color-neutral-700)]">
            {aggregate.totalEvents.toLocaleString()} events · {aggregate.paymentsCount.toLocaleString()} payments · {rangeLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex border-2 border-[var(--color-ink)]">
            {presetBtn('7', '7 days')}
            {presetBtn('term', 'Term', !termFrom)}
            {presetBtn('all', 'All')}
          </div>
          <button onClick={handleExport} disabled={exporting} className="m-btn m-btn-outline disabled:opacity-40">
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Search + count chips. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Student, parent, staff or amount"
          className="m-input min-w-[200px] flex-1"
        />
        {ACTIVITY_CATEGORIES.map((c) => {
          const active = (category || 'all') === c.key
          const label = c.key === 'all' ? 'All' : c.label
          const count = aggregate.categoryCounts[c.key]
          return (
            <button
              key={c.key}
              onClick={() => navigate({ category: c.key, page: '1' })}
              className={`border-2 px-3 py-1.5 text-xs font-semibold tracking-[0.04em] transition-colors ${
                active
                  ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]'
                  : 'border-[var(--color-neutral-300)] text-[var(--color-neutral-700)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]'
              }`}
            >
              {label} <span className="m-num">{count.toLocaleString()}</span>
            </button>
          )
        })}
      </div>

      <p className="mb-5 max-w-[76ch] text-[13px] text-[var(--color-neutral-800)]">
        This is the archive: money in, invoices out, messages, decisions and roster changes, newest first with no limit.
        Staff actions on settings and roles live separately under the Audit log, because that record answers a different question.
      </p>

      {total === 0 ? (
        <p className="py-6 text-sm text-[var(--color-neutral-700)]">
          {category === 'all' && range === '7' && !search
            ? 'Nothing in the last 7 days. Widen the range to Term or All to see more.'
            : 'No activity matches these filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/* Column header */}
          <div
            className="grid min-w-[654px] gap-3 border-b-2 border-[var(--color-ink)] pb-2"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)]">Time</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)]">Who</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)]">Event</span>
            <span className="text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)]">Amount</span>
            <span className="text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)]">Category</span>
          </div>

          {groups.map((g) => (
            <div key={g.key}>
              {/* Day divider */}
              <div className="flex min-w-[654px] items-baseline gap-3 border-b border-[var(--color-neutral-300)] pb-1.5 pt-[18px]">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">{g.label}</span>
                <span className="m-num text-[11px] text-[var(--color-neutral-700)]">
                  {g.events} {g.events === 1 ? 'event' : 'events'}{g.received > 0 ? ` · ${formatNaira(g.received)} received` : ''}
                </span>
              </div>

              {g.rows.map((event) => {
                const received = event.eventType === 'payment_received'
                return (
                  <div
                    key={event.id}
                    onClick={event.linkHref ? () => router.push(event.linkHref!) : undefined}
                    className={`grid min-w-[654px] items-baseline gap-3 border-b border-[var(--color-neutral-300)] py-[11px] transition-colors hover:bg-[var(--color-neutral-200)] ${event.linkHref ? 'cursor-pointer' : ''}`}
                    style={{ gridTemplateColumns: GRID_COLS }}
                    title={formatDateTime(event.occurredAt)}
                  >
                    <span className="m-num text-[13px] text-[var(--color-neutral-700)]">{fmtClock(event.occurredAt)}</span>
                    <span className="text-[14px] font-semibold text-[var(--color-ink)]">{event.who}</span>
                    <span className="min-w-0 text-[13px] text-[var(--color-neutral-800)]">
                      {event.title}
                      {event.subtitle ? <span className="block text-[11px] text-[var(--color-neutral-700)]">{event.subtitle}</span> : null}
                    </span>
                    <span
                      className="m-num text-right text-[14px]"
                      style={{
                        color: event.amount === null ? 'var(--color-neutral-700)' : received ? 'var(--color-ledger)' : 'var(--color-neutral-800)',
                        fontWeight: received ? 600 : 400,
                      }}
                    >
                      {event.amount !== null ? formatNaira(event.amount) : '—'}
                    </span>
                    <span
                      className="text-right text-[12px] font-semibold tracking-[0.08em]"
                      style={{ color: categoryColor(event) }}
                    >
                      {CAT_LABEL[event.category]}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Pagination: newest first, so "Newer" walks toward page 1. */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5">
          <span className="m-num text-[13px] text-[var(--color-neutral-700)]">
            Showing {rangeStart}–{rangeEnd} of {total} in range
          </span>
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-[13px] text-[var(--color-neutral-700)]">
              <span className="hidden sm:inline">Show</span>
              <span className="flex items-center gap-2.5">
                {ACTIVITY_PAGE_SIZE_OPTIONS.map((n) => (
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
      )}
    </div>
    </>
  )
}
