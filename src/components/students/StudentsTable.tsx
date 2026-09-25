'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { StudentSortDir, StudentSortKey, StudentInvoiceStatusFilter } from '@/lib/queries/students'

interface Student {
  id: string
  firstName: string
  lastName: string
  admissionNumber: string
  status: string
  className: string
  classId: string
  parentName: string
  parentPhone: string
  invoiceTotal: number
  invoicePaid: number
  creditApplied: number
  invoiceStatus: string
  invoiceSent: boolean
  outstandingBalance: number
}

interface Class {
  id: string
  name: string
}

interface StudentsTableProps {
  students: Student[]
  classes: Class[]
  total: number
  page: number
  perPage: number
  search: string
  classId: string
  invoiceStatus: string
  statusFilter: 'active' | 'withdrawn' | 'graduated' | 'all'
  statusCounts: { active: number; withdrawn: number; graduated: number; all: number }
  invoiceCounts: { all: number; owing: number; notBilled: number }
  sortKey: StudentSortKey
  sortDir: StudentSortDir
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

// Tailwind's WASM build doesn't emit arbitrary grid utilities, so the roster's
// column track has to live in an inline style. This is the App Shell roster
// grid verbatim: name gets the most room, the money columns are right-sized.
const GRID_COLS = 'minmax(150px,2fr) minmax(120px,1.3fr) minmax(96px,1fr) minmax(90px,1fr) minmax(96px,1fr)'

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

// Per-row payment state is colour-carrying right-aligned TEXT, never a bordered
// pill: green (SETTLED) only where money fully arrived, ochre where a human
// still owes (PARTIAL / OVERDUE / NOT SENT), neutral where nothing's been
// billed (NOT BILLED). Red is never a row state (reserved for structure and
// destructive actions). The uppercase vocabulary is the App Shell roster's:
// a sent-but-unpaid invoice reads OVERDUE (it needs chasing), one still sitting
// un-delivered reads NOT SENT, so the word tells the bursar what to do next.
function stateInk(status: string, sent: boolean): { label: string; color: string } {
  if (status === 'paid') return { label: 'SETTLED', color: 'var(--color-ledger)' }
  if (status === 'partial') return { label: 'PARTIAL', color: 'var(--color-ochre-text)' }
  if (status === 'overdue') return { label: 'OVERDUE', color: 'var(--color-ochre-text)' }
  if (status === 'pending') {
    return sent
      ? { label: 'OVERDUE', color: 'var(--color-ochre-text)' }
      : { label: 'NOT SENT', color: 'var(--color-ochre-text)' }
  }
  return { label: 'NOT BILLED', color: 'var(--color-neutral-500)' }
}

// The chips map the granular invoice-status URL param onto the three roster
// groupings the App Shell shows. Anything outside these three (a granular
// paid/partial/pending/no_invoice picked in More filters) leaves all chips off.
const CHIPS: { key: StudentInvoiceStatusFilter; label: string; countKey: 'all' | 'owing' | 'notBilled' }[] = [
  { key: 'all', label: 'All', countKey: 'all' },
  { key: 'owing', label: 'Owing', countKey: 'owing' },
  { key: 'not_billed', label: 'Not billed', countKey: 'notBilled' },
]

const SORT_OPTIONS: { key: StudentSortKey; dir: StudentSortDir; label: string }[] = [
  { key: 'class', dir: 'asc', label: 'Class grouping' },
  { key: 'name', dir: 'asc', label: 'Name (A–Z)' },
  { key: 'name', dir: 'desc', label: 'Name (Z–A)' },
  { key: 'total', dir: 'desc', label: 'Total expected (high–low)' },
  { key: 'paid', dir: 'desc', label: 'Paid (high–low)' },
  { key: 'status', dir: 'asc', label: 'Payment status' },
]

// Search, chips, class, lifecycle status, granular invoice status, sort and
// page are all server-driven via the URL: the roster can run into the hundreds,
// and only the current page's students (and their invoice figures) are ever
// fetched — recomputing every column client-side on each keystroke would mean
// downloading and re-sorting the whole school.
export default function StudentsTable({
  students,
  classes,
  total,
  page,
  perPage,
  search,
  classId,
  invoiceStatus,
  statusFilter,
  statusCounts,
  invoiceCounts,
  sortKey,
  sortDir,
}: StudentsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [searchInput, setSearchInput] = useState(search)
  // Open More filters automatically when a filter that lives inside it is
  // already in force, so an active filter is never hidden behind a closed panel.
  const [showFilters, setShowFilters] = useState(
    statusFilter !== 'active' ||
    classId !== 'all' ||
    (invoiceStatus !== 'all' && invoiceStatus !== 'owing' && invoiceStatus !== 'not_billed')
  )

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
      search,
      class: classId,
      status: statusFilter,
      invoiceStatus,
      sort: sortKey,
      dir: sortDir,
      ...patch,
    })
    for (const key of Array.from(params.keys())) {
      if (!params.get(key) || params.get(key) === 'all') params.delete(key)
    }
    // 'active' is the roster default, so it never needs to sit in the URL.
    if (params.get('status') === 'active') params.delete('status')
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  // Debounce the search box so typing doesn't fire a navigation (and a fresh
  // server fetch) on every keystroke — only once the user pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) navigate({ search: searchInput, page: '1' })
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  useEffect(() => {
    setSearchInput(search)
  }, [search])

  // Class group-header rows show when grouping by class with no class filter —
  // purely visual. The count beside each header is only the students in that
  // class ON THIS PAGE (the full filtered set no longer lives in the browser),
  // so a page-spanning class repeats its header at the top of the next page.
  const groupByClass = sortKey === 'class' && classId === 'all'

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  const classCountsOnPage: Record<string, number> = {}
  students.forEach((s) => {
    classCountsOnPage[s.classId] = (classCountsOnPage[s.classId] || 0) + 1
  })

  const activeChip: StudentInvoiceStatusFilter =
    invoiceStatus === 'owing' ? 'owing' : invoiceStatus === 'not_billed' ? 'not_billed' : invoiceStatus === 'all' ? 'all' : 'all'
  // Only light the "All" chip when no granular invoice filter is narrowing.
  const granularActive = invoiceStatus !== 'all' && invoiceStatus !== 'owing' && invoiceStatus !== 'not_billed'

  const currentSortValue = `${sortKey}:${sortDir}`

  return (
    <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: '18px' }}>
      {/* Toolbar — search, roster chips, More filters disclosure */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <input
          type="text"
          placeholder="Name, admission no., parent"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="m-input flex-1"
          style={{ minWidth: '220px' }}
        />
        {CHIPS.map((chip) => (
          <button
            key={chip.key}
            onClick={() => navigate({ invoiceStatus: chip.key, page: '1' })}
            data-active={!granularActive && activeChip === chip.key}
            className="m-filter-chip m-num"
          >
            {chip.label} {invoiceCounts[chip.countKey].toLocaleString('en-NG')}
          </button>
        ))}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="text-[13px] font-semibold text-[var(--color-ink)] underline underline-offset-4 decoration-[var(--color-neutral-400)] hover:decoration-[var(--color-ink)]"
        >
          {showFilters ? 'Fewer filters' : 'More filters'}
        </button>
      </div>

      {/* More filters — homes the lifecycle status, class, granular invoice
          status, sort and per-page controls that don't live in the chip row. */}
      {showFilters && (
        <div className="flex flex-wrap gap-x-6 gap-y-4 pb-5 mb-2 border-b border-[var(--color-neutral-300)]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-700)]">Student status</span>
            <select
              value={statusFilter}
              onChange={(e) => navigate({ status: e.target.value, page: '1' })}
              className="m-select"
              style={{ minWidth: '170px' }}
            >
              <option value="active">Active ({statusCounts.active})</option>
              <option value="withdrawn">Withdrawn ({statusCounts.withdrawn})</option>
              <option value="graduated">Graduated ({statusCounts.graduated})</option>
              <option value="all">All statuses ({statusCounts.all})</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-700)]">Class</span>
            <select
              value={classId}
              onChange={(e) => navigate({ class: e.target.value, page: '1' })}
              className="m-select"
              style={{ minWidth: '170px' }}
            >
              <option value="all">All classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>{cls.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-700)]">Invoice status</span>
            <select
              value={granularActive ? invoiceStatus : 'all'}
              onChange={(e) => navigate({ invoiceStatus: e.target.value, page: '1' })}
              className="m-select"
              style={{ minWidth: '150px' }}
            >
              <option value="all">Any</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="pending">Unpaid</option>
              <option value="no_invoice">No invoice</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-700)]">Sort by</span>
            <select
              value={currentSortValue}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(':')
                navigate({ sort: key, dir, page: '1' })
              }}
              className="m-select"
              style={{ minWidth: '190px' }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={`${o.key}:${o.dir}`} value={`${o.key}:${o.dir}`}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <p className="text-[13px] text-[var(--color-neutral-800)] mb-4" style={{ maxWidth: '74ch' }}>
        Rows needing attention carry the outstanding figure in the heaviest weight on the line, so what
        is owed reads first. Class grouping is preserved because that is how a bursar thinks.
      </p>

      {total === 0 ? (
        <div className="py-16" style={{ maxWidth: '60ch' }}>
          {statusCounts.all === 0 ? (
            /* True first-run: the school has no students at all (count is the
               unfiltered roster total). Weighted two ways forward, and names the
               columns the importer expects before the user goes looking. */
            <>
              <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">No students yet</p>
              <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)] mb-4">
                Import your existing list as a spreadsheet if the school already has one, or add a
                student by hand to try things out. The importer expects a column for first name, last
                name, admission number, class, parent name and parent phone.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => router.push('/students/import')} className="m-btn m-btn-primary">Import CSV</button>
                <span className="text-[13px] text-[var(--color-neutral-700)]">or use Add student above to enter one by hand.</span>
              </div>
            </>
          ) : search ? (
            /* Search returned nothing. Keep the query visible so a typo is
               obvious, name what search covers, and offer a way back. */
            <>
              <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">No student matches &ldquo;{search}&rdquo;</p>
              <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)] mb-4">
                Search looks at name, admission number and parent phone. Check for a typo, or clear the
                search to see the whole roster.
              </p>
              <button onClick={() => { setSearchInput(''); navigate({ search: '', page: '1' }) }} className="m-btn m-btn-outline">Clear search</button>
            </>
          ) : (
            /* A class / lifecycle / invoice-status filter excluded everyone. */
            <>
              <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">No students match these filters</p>
              <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)] mb-4">
                No one on the roster fits the filters you have set.
              </p>
              <button onClick={() => { setSearchInput(''); router.push(pathname) }} className="m-btn m-btn-outline">Clear filters</button>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* Column header */}
          <div
            className="grid"
            style={{ gridTemplateColumns: GRID_COLS, gap: '12px', minWidth: '600px', padding: '0 0 8px', borderBottom: '2px solid var(--color-ink)' }}
          >
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">STUDENT</span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">PARENT</span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)] text-right">OUTSTANDING</span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)] text-right">PAID</span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)] text-right">STATE</span>
          </div>

          {(() => {
            let lastClassId: string | null = null
            return students.flatMap((student) => {
              const rows: any[] = []

              if (groupByClass && student.classId !== lastClassId) {
                lastClassId = student.classId
                rows.push(
                  <div
                    key={`group-${student.classId}`}
                    style={{ padding: '16px 0 6px', borderBottom: '1px solid var(--color-neutral-300)', minWidth: '600px' }}
                  >
                    <span className="text-[11px] font-semibold text-[var(--color-ink)]" style={{ letterSpacing: '0.14em' }}>
                      {student.className || 'No class'}
                    </span>
                    <span className="text-[11px] text-[var(--color-neutral-700)] ml-2 m-num">
                      {classCountsOnPage[student.classId] || 0} on this page
                    </span>
                  </div>
                )
              }

              const owing = student.outstandingBalance
              const owingActive = owing > 0
              const state = stateInk(student.invoiceStatus, student.invoiceSent)
              const hasCurrentInvoice = student.invoiceStatus !== 'no_invoice'

              rows.push(
                <div
                  key={student.id}
                  onClick={() => router.push(`/students/${student.id}`)}
                  className="m-trow"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: GRID_COLS,
                    gap: '12px',
                    minWidth: '600px',
                    padding: '12px 0',
                    borderBottom: '1px solid var(--color-neutral-300)',
                    alignItems: 'baseline',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p className="text-sm font-semibold text-[var(--color-ink)] m-0 truncate">
                      {student.firstName} {student.lastName}
                    </p>
                    <p className="text-xs text-[var(--color-neutral-700)] mt-0.5 m-num">{student.admissionNumber}</p>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p className="text-[13px] text-[var(--color-neutral-800)] m-0 truncate">{student.parentName}</p>
                    <p className="text-xs text-[var(--color-neutral-700)] mt-0.5 m-num">{student.parentPhone}</p>
                  </div>
                  <p
                    className="text-[15px] text-right m-num m-0"
                    style={{ fontWeight: owingActive ? 700 : 400, color: owingActive ? 'var(--color-ink)' : 'var(--color-neutral-500)' }}
                  >
                    {owingActive ? formatNaira(owing) : '—'}
                  </p>
                  <p
                    className="text-sm text-right m-num m-0"
                    style={{ color: hasCurrentInvoice && student.invoicePaid > 0 ? 'var(--color-ledger)' : 'var(--color-neutral-700)' }}
                  >
                    {hasCurrentInvoice ? formatNaira(student.invoicePaid) : '—'}
                  </p>
                  <p
                    className="text-xs font-semibold text-right m-0"
                    style={{ letterSpacing: '0.08em', color: state.color }}
                  >
                    {state.label}
                  </p>
                </div>
              )
              return rows
            })
          })()}

          {/* Footer — range + owing count, plus Prev / page / Next */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5" style={{ minWidth: '600px' }}>
            <span className="text-[13px] text-[var(--color-neutral-700)] m-num">
              Showing {rangeStart}–{rangeEnd} of {total} · {invoiceCounts.owing.toLocaleString('en-NG')} owing
            </span>
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[var(--color-neutral-700)]">Show</span>
                <span className="flex items-center gap-2.5">
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => navigate({ perPage: String(n), page: '1' })}
                      className="m-num"
                      style={{
                        background: 'none', border: 0, padding: 0, cursor: 'pointer',
                        fontSize: 13, fontWeight: perPage === n ? 700 : 400,
                        color: perPage === n ? 'var(--color-ink)' : 'var(--color-neutral-700)',
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => navigate({ page: String(page - 1) })}
                  disabled={page <= 1}
                  className="text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ padding: '9px 10px' }}
                >
                  Prev
                </button>
                <span className="text-[13px] m-num px-1.5 text-[var(--color-ink)]">{page} / {totalPages}</span>
                <button
                  onClick={() => navigate({ page: String(page + 1) })}
                  disabled={page >= totalPages}
                  className="text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ padding: '9px 10px' }}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
