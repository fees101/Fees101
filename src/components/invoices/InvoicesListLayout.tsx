'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AllInvoiceRow, InvoiceCounts, InvoiceLedgerTotals, InvoiceStatusFilter, INVOICES_PAGE_SIZE_OPTIONS } from '@/lib/invoices/invoiceListMeta'
import { exportInvoicesCSV } from '@/app/(app)/money/invoices/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'
import { useActiveJobs, useOnJobOpenRequested } from '@/lib/jobs/ActiveJobsProvider'
import BulkSendInvoicesPanel from '@/components/invoices/BulkSendInvoicesPanel'
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'

interface Props {
  rows: AllInvoiceRow[]
  total: number
  page: number
  perPage: number
  terms: { id: string; name: string }[]
  counts: InvoiceCounts
  ledger: InvoiceLedgerTotals
  statusFilter: InvoiceStatusFilter
  termFilter: string
  search: string
  schoolId: string
}

// The invoice ledger sits on the ink ground (App Shell "REWORK · INK GROUND"):
// a dark instrument surface where received money reads in lifted ledger green
// and outstanding in lifted amber. These are the on-ink values — the
// paper-ground --color-ledger / --color-ochre are too dark to read on ink.
const INK = {
  paper: '#f3f2f2',
  dim: '#9b9797',
  faint: '#d7d3d3',
  rule: '#605d5d',
  ruleSoft: '#444141',
  green: '#35c483', // --color-ledger-on-ink
  amber: '#f0a13c', // ochre lifted for the ink ground
}

// Six columns, shared by the header, every row and the page-total footer so
// they line up. Inline (not a Tailwind class) because the WASM build doesn't
// emit arbitrary multi-minmax grid templates.
const GRID = 'minmax(80px,0.8fr) minmax(130px,1.8fr) minmax(56px,0.5fr) minmax(88px,1fr) minmax(96px,1.1fr) minmax(92px,1fr)'

function formatNaira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

// Per-row state as colour-carrying text, no pills: green only where the invoice
// is fully settled, amber for anything awaiting a human, dim for inert.
function rowState(inv: AllInvoiceRow): { label: string; color: string } {
  if (inv.status === 'cancelled') return { label: 'CANCELLED', color: INK.dim }
  if (inv.needsResend) return { label: 'NEEDS RESEND', color: INK.amber }
  if (inv.status === 'paid') return { label: 'SETTLED', color: INK.green }
  if (inv.status === 'partial') return { label: 'PARTIAL', color: INK.amber }
  if (inv.status === 'overdue') return { label: 'OVERDUE', color: INK.amber }
  if (!inv.sentAt) return { label: 'NOT SENT', color: INK.amber }
  return { label: 'UNPAID', color: INK.dim }
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function InvoicesListLayout({
  rows, total, page, perPage, terms, counts, ledger, statusFilter, termFilter, search, schoolId,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  // Payments also drive the paid/partial/needs-resend state shown here, so a
  // payment landing via webhook needs to refresh this list too, not just the
  // invoice it belongs to.
  useRealtimeRefresh(
    schoolId
      ? [
          { table: 'invoices', filter: `school_id=eq.${schoolId}` },
          { table: 'payments', filter: `school_id=eq.${schoolId}` },
        ]
      : []
  )
  const canSeeInvoices = useCan('see-invoices')
  const canManageInvoices = useCan('manage-invoices')

  const [searchInput, setSearchInput] = useState(search)
  const [exporting, setExporting] = useState(false)

  // Search, term/status filters, page and page size are all server-driven via
  // the URL — the same principle as Students/Audit log/Recent Activity, and
  // the fix for this page specifically not having been on that pattern before.
  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({
      filter: statusFilter, term: termFilter, q: search,
      page: String(page), perPage: String(perPage),
      ...patch,
    })
    for (const key of Array.from(params.keys())) {
      if (!params.get(key) || params.get(key) === 'all') params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  // Debounce the search box so typing doesn't fire a navigation (and a fresh
  // server fetch) on every keystroke — only once the user pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) navigate({ q: searchInput, page: '1' })
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  useEffect(() => { setSearchInput(search) }, [search])

  const { findRunningJob } = useActiveJobs()
  // Re-derived every render (not frozen in useState) so the button stays
  // disabled with a live "Sending..." label for as long as the job is
  // actually running — including after the panel has been closed via
  // "Run in background".
  const existingJob = findRunningJob(j => j.jobType === 'bulk_send')
  const [bulkSendOpen, setBulkSendOpen] = useState(!!existingJob)
  const sendRunning = !!existingJob
  useOnJobOpenRequested(existingJob?.jobId, () => setBulkSendOpen(true))

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)
  const pageTotals = rows.reduce((acc, inv) => {
    acc.paid += inv.paidAmount
    acc.out += inv.outstandingAmount
    return acc
  }, { paid: 0, out: 0 })

  const termLabel = termFilter === 'all'
    ? 'ALL TERMS'
    : (terms.find(t => t.id === termFilter)?.name || 'TERM').toUpperCase()

  async function handleExport() {
    setExporting(true)
    const result = await exportInvoicesCSV({ statusFilter, termFilter, search })
    setExporting(false)
    if ('error' in result) return
    const header = ['Invoice', 'Student', 'Admission', 'Class', 'Term', 'Total', 'Paid', 'Outstanding', 'State']
    const lines = [header.join(',')]
    for (const inv of result.rows) {
      lines.push([
        csvCell(inv.invoiceNumber),
        csvCell(`${inv.studentFirstName} ${inv.studentLastName}`),
        csvCell(inv.studentAdmissionNumber),
        csvCell(inv.className),
        csvCell(inv.cycleName),
        csvCell(inv.totalAmount),
        csvCell(inv.paidAmount),
        csvCell(inv.outstandingAmount),
        csvCell(rowState(inv).label),
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (!canSeeInvoices) return null

  // Ink-ground control styles (the m- field/chip classes are tuned for paper).
  const chip = (value: InvoiceStatusFilter, label: string, count: number, show = true) => {
    if (!show) return null
    const active = statusFilter === value
    return (
      <button
        key={value}
        onClick={() => navigate({ filter: value, page: '1' })}
        style={{
          background: active ? INK.paper : 'transparent',
          color: active ? 'var(--color-ink)' : INK.faint,
          border: `1px solid ${active ? INK.paper : INK.rule}`,
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
        }}
      >
        {label} <span className="m-num">{count.toLocaleString()}</span>
      </button>
    )
  }

  return (
    <>
      <WorkspaceHeader
        workspaceKey="money"
        title="Invoices"
        actions={
          canManageInvoices && (counts.needsSend > 0 || sendRunning) ? (
            <button
              onClick={() => setBulkSendOpen(true)}
              disabled={bulkSendOpen && sendRunning}
              title={sendRunning && !bulkSendOpen ? 'A send is already running — click to view its progress' : undefined}
              className="m-btn m-btn-primary"
            >
              {sendRunning ? `Sending... (${existingJob.processed} sent)` : `Send ${counts.needsSend} ${counts.needsResend > 0 ? 'pending' : 'unsent'}`}
            </button>
          ) : undefined
        }
      />

      {bulkSendOpen && (
        <div className="px-4 sm:px-7 pt-6">
          <BulkSendInvoicesPanel count={counts.needsSend} onClose={() => setBulkSendOpen(false)} />
        </div>
      )}

      {total === 0 && statusFilter === 'all' && termFilter === 'all' && !search ? (
        <div className="px-4 sm:px-7 py-7">
          <div className="py-12 border-t-2 border-[var(--color-ink)]" style={{ maxWidth: '60ch' }}>
            <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">No invoices yet</p>
            <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)] mb-4">
              Invoices are generated per term, once that term has fees set up and active students. Generate a
              term&apos;s invoices from its page and they will show up here.
            </p>
            {canManageInvoices && (
              <button onClick={() => router.push('/fees/cycles')} className="m-btn m-btn-primary">Go to terms</button>
            )}
          </div>
        </div>
      ) : (
        // Full-bleed ink ground: flush under the tabs and out to the content
        // edges, its own interior padding (App Shell "REWORK · INK GROUND").
        <div
          style={{ background: 'var(--color-ink)', color: INK.paper }}
          className="px-5 sm:px-7 py-7 m-anim-fade"
        >
            {/* Ledger hero */}
            <div
              className="flex flex-wrap items-start justify-between gap-6 pb-5 mb-5"
              style={{ borderBottom: `2px solid ${INK.rule}` }}
            >
              <div>
                <p className="text-[11px] tracking-[0.16em] mb-2" style={{ color: INK.dim }}>LEDGER TOTAL · {termLabel}</p>
                <p className="m-num text-[46px] font-extrabold leading-[0.9] tracking-[-0.03em]" style={{ color: '#ffffff' }}>{formatNaira(ledger.total)}</p>
                {ledger.creditApplied > 0 && (
                  <p className="m-num text-[12px] mt-1.5" style={{ color: INK.dim }}>
                    {formatNaira(ledger.subtotal)} − {formatNaira(ledger.creditApplied)} credit
                  </p>
                )}
              </div>
              <div className="flex gap-8">
                <div>
                  <p className="text-[11px] tracking-[0.14em] mb-1.5" style={{ color: INK.dim }}>RECEIVED</p>
                  <p className="m-num text-[24px] font-extrabold" style={{ color: INK.green }}>{formatNaira(ledger.received)}</p>
                </div>
                <div>
                  <p className="text-[11px] tracking-[0.14em] mb-1.5" style={{ color: INK.dim }}>OUTSTANDING</p>
                  <p className="m-num text-[24px] font-extrabold" style={{ color: INK.amber }}>{formatNaira(ledger.outstanding)}</p>
                </div>
              </div>
            </div>

            {/* Filter chips + controls */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {chip('all', 'All', counts.all)}
              {chip('settled', 'Settled', counts.settled)}
              {chip('partial', 'Partial', counts.partial)}
              {chip('overdue', 'Overdue', counts.overdue)}
              {chip('needs_resend', 'Needs resend', counts.needsResend, counts.needsResend > 0)}
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                {terms.length > 1 && (
                  <select
                    value={termFilter}
                    onChange={(e) => navigate({ term: e.target.value, page: '1' })}
                    style={{ background: 'transparent', color: INK.paper, border: `2px solid ${INK.rule}`, padding: '7px 10px', fontSize: 13, minHeight: 36 }}
                  >
                    <option value="all" style={{ color: '#000' }}>All terms</option>
                    {terms.map((t) => (
                      <option key={t.id} value={t.id} style={{ color: '#000' }}>{t.name}</option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Name, admission no., invoice no."
                  style={{ background: 'transparent', color: INK.paper, border: `2px solid ${INK.rule}`, padding: '7px 10px', fontSize: 13, minHeight: 36, minWidth: 190 }}
                />
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  style={{ background: 'transparent', color: INK.paper, border: `2px solid ${INK.paper}`, padding: '7px 14px', fontSize: 13, fontWeight: 800, cursor: exporting ? 'default' : 'pointer', minHeight: 36, opacity: exporting ? 0.6 : 1 }}
                >
                  {exporting ? 'Exporting...' : 'Export'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              {/* Column header */}
              <div
                className="grid gap-2.5 pb-2"
                style={{ gridTemplateColumns: GRID, minWidth: 600, borderBottom: `2px solid ${INK.rule}` }}
              >
                <span className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: INK.dim }}>INVOICE</span>
                <span className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: INK.dim }}>STUDENT</span>
                <span className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: INK.dim }}>CLASS</span>
                <span className="text-right text-[11px] font-semibold tracking-[0.1em]" style={{ color: INK.dim }}>PAID</span>
                <span className="text-right text-[11px] font-semibold tracking-[0.1em]" style={{ color: INK.dim }}>OUTSTANDING</span>
                <span className="text-right text-[11px] font-semibold tracking-[0.1em]" style={{ color: INK.dim }}>STATE</span>
              </div>

              {rows.length === 0 ? (
                <p className="py-12 text-sm" style={{ color: INK.dim }}>No invoices match this filter.</p>
              ) : (
                rows.map(inv => {
                  const st = rowState(inv)
                  return (
                    <div
                      key={inv.id}
                      onClick={() => router.push(`/money/invoices/${inv.id}`)}
                      className="grid gap-2.5 items-baseline cursor-pointer"
                      style={{ gridTemplateColumns: GRID, minWidth: 600, padding: '12px 0', borderBottom: `1px solid ${INK.ruleSoft}` }}
                    >
                      <span className="m-num text-[13px]" style={{ color: INK.dim }}>{inv.invoiceNumber || '—'}</span>
                      <div style={{ minWidth: 0 }}>
                        <p className="text-[14px] font-semibold" style={{ color: INK.paper }}>{inv.studentLastName}, {inv.studentFirstName}</p>
                        <p className="m-num text-[12px] mt-0.5" style={{ color: INK.dim }}>{inv.studentAdmissionNumber}</p>
                      </div>
                      <span className="text-[13px]" style={{ color: INK.faint }}>{inv.className}</span>
                      <p className="m-num text-right text-[14px]" style={{ color: inv.paidAmount > 0 ? INK.green : INK.dim }}>{formatNaira(inv.paidAmount)}</p>
                      <div className="text-right">
                        <p className="m-num text-[15px]" style={{ color: inv.outstandingAmount > 0 ? INK.paper : INK.dim, fontWeight: inv.outstandingAmount > 0 ? 700 : 400 }}>{formatNaira(inv.outstandingAmount)}</p>
                        {inv.carriedForwardToCycleName && (
                          <p className="text-[11px] mt-0.5" style={{ color: INK.dim }}>&rarr; {inv.carriedForwardToCycleName}</p>
                        )}
                        {inv.creditApplied > 0 && (
                          <p className="m-num text-[11px] mt-0.5" style={{ color: INK.green }}>&minus; {formatNaira(inv.creditApplied)} credit</p>
                        )}
                      </div>
                      <p className="text-right text-[12px] font-semibold tracking-[0.08em]" style={{ color: st.color }}>{st.label}</p>
                    </div>
                  )
                })
              )}

              {/* Page total */}
              {rows.length > 0 && (
                <div
                  className="grid gap-2.5"
                  style={{ gridTemplateColumns: GRID, minWidth: 600, padding: '14px 0 0', borderTop: `2px solid ${INK.paper}`, marginTop: 2 }}
                >
                  <span />
                  <span className="text-[12px] font-semibold tracking-[0.1em]" style={{ color: INK.dim }}>PAGE TOTAL</span>
                  <span />
                  <span className="m-num text-right text-[15px] font-extrabold" style={{ color: INK.green }}>{formatNaira(pageTotals.paid)}</span>
                  <span className="m-num text-right text-[15px] font-extrabold" style={{ color: INK.amber }}>{formatNaira(pageTotals.out)}</span>
                  <span />
                </div>
              )}
            </div>

            {/* Pagination */}
            {total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
                <span className="m-num text-[13px]" style={{ color: INK.dim }}>
                  Showing {rangeStart}&ndash;{rangeEnd} of {total}
                </span>
                <div className="flex flex-wrap items-center gap-5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px]" style={{ color: INK.dim }}>Show</span>
                    <div className="flex items-center gap-2.5">
                      {INVOICES_PAGE_SIZE_OPTIONS.map((n) => (
                        <button
                          key={n}
                          onClick={() => navigate({ perPage: String(n), page: '1' })}
                          className="m-num"
                          style={{
                            background: 'none', border: 0, padding: 0, cursor: 'pointer',
                            fontSize: 13, fontWeight: perPage === n ? 700 : 400,
                            color: perPage === n ? INK.paper : INK.dim,
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => navigate({ page: String(page - 1) })}
                      disabled={page <= 1}
                      style={{ background: 'transparent', color: page <= 1 ? INK.ruleSoft : INK.faint, border: 0, padding: '6px 8px', fontSize: 13, fontWeight: 600, cursor: page <= 1 ? 'default' : 'pointer' }}
                    >
                      &larr; Prev
                    </button>
                    <span className="m-num text-[13px] px-1.5" style={{ color: INK.paper }}>{page} / {totalPages}</span>
                    <button
                      onClick={() => navigate({ page: String(page + 1) })}
                      disabled={page >= totalPages}
                      style={{ background: 'transparent', color: page >= totalPages ? INK.ruleSoft : INK.faint, border: 0, padding: '6px 8px', fontSize: 13, fontWeight: 600, cursor: page >= totalPages ? 'default' : 'pointer' }}
                    >
                      Next &rarr;
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
    </>
  )
}
