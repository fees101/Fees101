'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { CycleDetailData, CycleInvoiceFilter, InvoiceRow } from '@/lib/queries/fees'
import GenerateInvoicesPanel from './GenerateInvoicesPanel'
import { regenerateInvoice, startInvoiceRegenerationJob } from '@/app/(app)/fees/cycles/actions'
import { sendInvoiceUpdateNotice } from '@/app/(app)/invoices/actions'
import { useActiveJobs, useTrackedJob, useOnJobOpenRequested } from '@/lib/jobs/ActiveJobsProvider'
import { useCan } from '@/lib/auth/PermissionsProvider'
import { formatDate } from '@/lib/format/date'
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'

interface Props {
  data: CycleDetailData
  showFinancials?: boolean
  schoolId: string
}

// Kept as a plain local constant (not imported from fees.ts) so this client
// component never pulls a real value out of that module — fees.ts chains
// into server-only code (next/headers via the Supabase server client), and
// importing anything but a type from it here would drag that whole graph
// into the browser bundle. Mirrors the same workaround already used by
// StudentsTable's PAGE_SIZE_OPTIONS.
const CYCLE_INVOICES_PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function getPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (currentPage <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (currentPage >= totalPages - 2) {
    return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

function statusBadge(inv: InvoiceRow) {
  // Cancelled overrides everything — a dead invoice never reads as "needs
  // resend" just because that flag happened to be set at cancellation time.
  if (inv.status === 'cancelled') return { cls: 'bg-gray-100 text-gray-500', label: 'cancelled' }
  if (inv.needsResend) return { cls: 'bg-amber-50 text-amber-700', label: 'needs resend' }
  if (inv.status === 'paid') return { cls: 'bg-mint-light text-mint', label: 'paid' }
  if (inv.status === 'partial') return { cls: 'bg-amber-50 text-amber-700', label: 'partial' }
  if (inv.status === 'overdue') return { cls: 'bg-red-50 text-red-700', label: 'overdue' }
  return { cls: 'bg-gray-100 text-gray-600', label: 'unpaid' }
}

function cycleStatusBadge(status: 'draft' | 'active' | 'closed') {
  if (status === 'active') return { cls: 'bg-mint-light text-mint', dot: 'bg-mint' }
  if (status === 'draft') return { cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' }
  return { cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' }
}

export default function CycleDetailLayout({ data, showFinancials = true, schoolId }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const canManageFeeStructure = useCan('manage-fee-structure')
  const canManageInvoices = useCan('manage-invoices')
  // Invoices carry billing_cycle_id, so those scope tightly to this cycle;
  // payments don't, so they're scoped to the school instead — still narrow
  // enough that a payment landing anywhere refreshes the staleness/status
  // figures here without missing one that belongs to this cycle.
  useRealtimeRefresh(
    data.cycle
      ? [
          { table: 'invoices', filter: `billing_cycle_id=eq.${data.cycle.id}` },
          { table: 'payments', filter: `school_id=eq.${schoolId}` },
        ]
      : []
  )
  const {
    cycle,
    invoices,
    invoicesTotal,
    page,
    perPage,
    filter,
    search,
    studentsWithoutInvoices,
    studentsWithoutInvoicesTotal,
    totalActiveStudents,
    totalsByStatus,
    lockedOutOfDate,
    autoRegenerableCount,
  } = data

  // Search box keeps a local, debounced buffer so typing doesn't trigger a
  // server round trip on every keystroke — only once the user pauses (see
  // the effect below). Filter, page and per-page are all applied immediately
  // since they're discrete clicks, not keystrokes.
  const [searchInput, setSearchInput] = useState(search)
  const [error, setError] = useState<string | null>(null)
  const { trackJob, findRunningJob, cancelJob } = useActiveJobs()
  const runningGeneration = findRunningJob(j => j.jobType === 'invoice_generation' && j.meta?.cycleId === cycle?.id)
  // Reopen the panel automatically if generation is already running (e.g. the
  // user navigated away with "Run in background" and came back via the
  // floating progress chip) — the panel resumes tracking instead of
  // re-starting.
  const [generatePanelOpen, setGeneratePanelOpen] = useState(!!runningGeneration)
  // Clicking the chip while already on this cycle's page doesn't navigate
  // anywhere, so force the panel open explicitly rather than relying on a
  // remount.
  useOnJobOpenRequested(runningGeneration?.jobId, () => setGeneratePanelOpen(true))
  const [regenerateJobId, setRegenerateJobId] = useState<string | null>(
    () => findRunningJob(j => j.jobType === 'invoice_regeneration' && j.meta?.cycleId === cycle?.id)?.jobId ?? null
  )
  const regenerateJob = useTrackedJob(regenerateJobId)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [regenerateSummary, setRegenerateSummary] = useState<string | null>(null)
  const regeneratingAll = !!regenerateJob && regenerateJob.status === 'running'
  const [notifyingId, setNotifyingId] = useState<string | null>(null)
  const [notifiedIds, setNotifiedIds] = useState<Set<string>>(new Set())

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
      filter,
      search,
      ...patch,
    })
    for (const key of Array.from(params.keys())) {
      if (!params.get(key) || params.get(key) === 'all') params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  function setFilter(next: CycleInvoiceFilter) {
    navigate({ filter: next, page: '1' })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  async function handleRegenerateAll() {
    if (!cycle) return
    setError(null)
    setRegenerateSummary(null)

    const started = await startInvoiceRegenerationJob(cycle.id)
    if ('error' in started) {
      setError(started.error ?? 'Something went wrong')
      return
    }
    runRegenerateAllJob(started.jobId, started.lockedCount)
  }

  function runRegenerateAllJob(jobId: string, lockedCount: number = 0) {
    if (!cycle) return
    setRegenerateJobId(jobId)
    const lockedNote = lockedCount > 0
      ? ` (${lockedCount} ${lockedCount === 1 ? 'invoice was' : 'invoices were'} left untouched — would drop below what's already been paid)`
      : ''
    trackJob(jobId, 'invoice_regeneration', 'Invoice regeneration', undefined, (job) => {
      if (job.status === 'failed') {
        setError(job.error || 'Something went wrong')
      } else {
        const reasons = Array.from(new Set((job.failures || []).map(f => f.error)))
        const failedNote = job.failed
          ? ` ${job.failed} failed${reasons.length ? ` (${reasons.join('; ')})` : ''}.`
          : ''
        if (job.status === 'cancelled') {
          setRegenerateSummary(
            `Cancelled — ${job.processed} ${job.processed === 1 ? 'invoice' : 'invoices'} updated before stopping.${lockedNote}${failedNote}`
          )
        } else {
          setRegenerateSummary(
            `${job.processed} ${job.processed === 1 ? 'invoice' : 'invoices'} updated to current fees.${lockedNote}${failedNote}`
          )
        }
        router.refresh()
      }
    }, { cycleId: cycle.id, href: `/fees/cycles/${cycle.id}` })
  }

  async function handleRegenerateOne(invoiceId: string) {
    setError(null)
    setRegeneratingId(invoiceId)
    const result = await regenerateInvoice(invoiceId)
    if ('error' in result) {
      setError(result.error)
    } else {
      router.refresh()
    }
    setRegeneratingId(null)
  }

  async function handleNotifyUpdate(invoiceId: string) {
    setNotifyingId(invoiceId)
    setError(null)
    const result = await sendInvoiceUpdateNotice(invoiceId)
    if ('error' in result) {
      setError(result.error)
    } else {
      setNotifiedIds(prev => new Set(prev).add(invoiceId))
    }
    setNotifyingId(null)
  }

  if (!cycle) {
    return (
      <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
        <p className="text-gray-500">Term not found.</p>
      </div>
    )
  }

  const badge = cycleStatusBadge(cycle.status)
  const isClosed = cycle.status === 'closed'
  const isDraft = cycle.status === 'draft'
  // cycle.invoiceCount reflects the whole cycle, not just the current page/
  // filter — this is "does the cycle have invoices at all", used to decide
  // between the print-all/generate-more affordances and the fully-empty state.
  const hasInvoices = cycle.invoiceCount > 0

  const totalPages = Math.max(1, Math.ceil(invoicesTotal / perPage))
  const rangeStart = invoicesTotal === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, invoicesTotal)

  return (
    <>
      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${badge.dot}`}></span>
            <h1 className="text-3xl font-bold text-navy">{cycle.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>
              {cycle.status}
            </span>
          </div>
          <p className="text-sm text-gray-500">
            {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
            <span className="text-gray-400 font-bold"> · </span>
            {isClosed && cycle.closedAt ? `Closed: ${formatDate(cycle.closedAt)}` : `Due: ${formatDate(cycle.dueDate)}`}
            {cycle.sessionName && (
              <>
                <span className="text-gray-400 font-bold"> · </span>
                Session: {cycle.sessionName}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManageFeeStructure && (
          <Link
            href={`/fees/structure?cycle=${cycle.id}`}
            className="px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Edit fees
          </Link>
          )}
          {hasInvoices && (

              <a href={`/api/cycles/${cycle.id}/pdf`}
              download
              className="px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print all ({cycle.invoiceCount})
            </a>
          )}
          {!isClosed && canManageInvoices && (
            <button
              onClick={() => setGeneratePanelOpen(true)}
              disabled={(studentsWithoutInvoicesTotal === 0 && !runningGeneration) || (generatePanelOpen && !!runningGeneration)}
              title={runningGeneration && !generatePanelOpen ? 'Generation is already running — click to view its progress' : undefined}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
            >
              {runningGeneration
                ? `Generating… (${runningGeneration.processed}/${runningGeneration.total || '?'})`
                : hasInvoices ? `Generate for ${studentsWithoutInvoicesTotal} new` : `Generate invoices`}
            </button>
          )}
        </div>
      </header>

      {isClosed && (
        <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-navy">This term is closed</p>
            <p className="text-xs text-gray-600 mt-0.5">No new invoices can be generated. Payments can still be recorded.</p>
          </div>
        </div>
      )}

      {isDraft && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-navy">This is a draft term</p>
            <p className="text-xs text-gray-600 mt-0.5">
              You can generate invoices to draft them in advance (e.g., to print and slot into student report cards). Activate the term from <Link href="/fees/cycles" className="text-mint hover:underline">Billing cycles</Link> when ready.
            </p>
          </div>
        </div>
      )}

      {!isClosed && (totalsByStatus.needsRegeneration > 0 || regeneratingAll) && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-navy">
              {totalsByStatus.needsRegeneration} {totalsByStatus.needsRegeneration === 1 ? 'invoice is' : 'invoices are'} out of date
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              Fees, opt-ins, or exemptions changed since these were generated. Regenerate to apply the current numbers — payments already made are preserved.
              {lockedOutOfDate > 0 && (
                <> {autoRegenerableCount} can be auto-regenerated; {lockedOutOfDate} {lockedOutOfDate === 1 ? 'is' : 'are'} locked against payments already made.</>
              )}
            </p>
          </div>
          {canManageInvoices && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={handleRegenerateAll}
              disabled={regeneratingAll}
              className="px-3 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              {regeneratingAll
                ? `Regenerating... ${regenerateJob?.processed ?? 0}/${regenerateJob?.total ?? 0}`
                : 'Regenerate all'}
            </button>
            {regeneratingAll && regenerateJobId && (
              <button
                onClick={() => cancelJob(regenerateJobId)}
                disabled={regenerateJob?.cancelling}
                className="text-xs text-red-600 hover:underline disabled:opacity-50 disabled:no-underline"
              >
                {regenerateJob?.cancelling ? 'Cancelling...' : 'Cancel'}
              </button>
            )}
          </div>
          )}
        </div>
      )}

      {runningGeneration && !generatePanelOpen && (
        <div className="mb-4 p-4 bg-mint-light/40 border border-mint/30 rounded-xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-mint border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-navy">
              Generating invoices in the background — {runningGeneration.processed}/{runningGeneration.total || '?'}
            </p>
          </div>
          <button
            onClick={() => setGeneratePanelOpen(true)}
            className="px-3 py-1.5 text-sm font-medium text-mint hover:underline flex-shrink-0"
          >
            View
          </button>
        </div>
      )}

      {regenerateSummary && (
        <div className="mb-4 p-3 bg-mint-light/40 border border-mint/30 rounded-lg text-sm text-navy flex items-center justify-between">
          {regenerateSummary}
          <button onClick={() => setRegenerateSummary(null)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className={`grid grid-cols-2 gap-4 mb-6 ${showFinancials ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Invoices</p>
          <p className="text-2xl font-bold text-navy">
            {cycle.invoiceCount} <span className="text-sm text-gray-400">/ {totalActiveStudents}</span>
          </p>
          {studentsWithoutInvoicesTotal > 0 && (
            <p className="text-xs text-amber-600 mt-1">{studentsWithoutInvoicesTotal} students missing</p>
          )}
        </div>
        {showFinancials && (
          <div className="bg-white p-4 rounded-xl border border-gray-200">
            <p className="text-xs text-gray-500 mb-1">Expected</p>
            <p className="text-2xl font-bold text-navy">{formatNaira(cycle.totalExpected)}</p>
          </div>
        )}
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Collected</p>
          <p className="text-2xl font-bold text-mint">
            {showFinancials
              ? formatNaira(cycle.totalCollected)
              : `${cycle.totalExpected > 0 ? Math.round((cycle.totalCollected / cycle.totalExpected) * 100) : 0}%`}
          </p>
          {cycle.totalExpected > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {showFinancials ? `${Math.round((cycle.totalCollected / cycle.totalExpected) * 100)}% collected` : 'of expected'}
              {cycle.invoiceCount > 0 && ` · ${totalsByStatus.paid}/${cycle.invoiceCount} paid up`}
            </p>
          )}
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Outstanding</p>
          <p className="text-2xl font-bold text-amber-600">
            {showFinancials
              ? formatNaira(cycle.totalOutstanding)
              : `${cycle.totalExpected > 0 ? Math.round((cycle.totalOutstanding / cycle.totalExpected) * 100) : 0}%`}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {!showFinancials && 'of expected, still owed'}
            {cycle.invoiceCount > 0 && `${!showFinancials ? ' · ' : ''}${totalsByStatus.partial + totalsByStatus.pending + totalsByStatus.overdue}/${cycle.invoiceCount} owe`}
          </p>
        </div>
      </div>

      {/* Filters */}
      {(hasInvoices || studentsWithoutInvoicesTotal > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'all' ? 'bg-navy text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            All {cycle.invoiceCount + studentsWithoutInvoicesTotal}
          </button>
          <button
            onClick={() => setFilter('paid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'paid' ? 'bg-mint text-navy' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Paid {totalsByStatus.paid}
          </button>
          <button
            onClick={() => setFilter('partial')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Partial {totalsByStatus.partial}
          </button>
          <button
            onClick={() => setFilter('unpaid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'unpaid' ? 'bg-gray-200 text-gray-800' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Unpaid {totalsByStatus.pending + totalsByStatus.overdue}
          </button>
          {totalsByStatus.needsResend > 0 && (
            <button
              onClick={() => setFilter('needs_resend')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'needs_resend' ? 'bg-amber-200 text-amber-800' : 'bg-white border border-gray-200 text-amber-700 hover:bg-amber-50'}`}
            >
              Needs resend {totalsByStatus.needsResend}
            </button>
          )}
          {totalsByStatus.needsRegeneration > 0 && (
            <button
              onClick={() => setFilter('out_of_date')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'out_of_date' ? 'bg-amber-200 text-amber-800' : 'bg-white border border-gray-200 text-amber-700 hover:bg-amber-50'}`}
            >
              Out of date {totalsByStatus.needsRegeneration}
            </button>
          )}
          {studentsWithoutInvoicesTotal > 0 && (
            <button
              onClick={() => setFilter('no_invoice')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'no_invoice' ? 'bg-red-100 text-red-800' : 'bg-white border border-gray-200 text-red-700 hover:bg-red-50'}`}
            >
              No invoice {studentsWithoutInvoicesTotal}
            </button>
          )}
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or admission #"
            className="ml-auto px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 w-64"
          />
        </div>
      )}

      {/* Empty state */}
      {!hasInvoices && studentsWithoutInvoicesTotal === 0 && (
        <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
          <p className="text-gray-500 mb-2">No active students yet.</p>
          <Link href="/students" className="text-mint hover:underline text-sm">
            Add students →
          </Link>
        </div>
      )}

      {!hasInvoices && studentsWithoutInvoicesTotal > 0 && (
        <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
          <p className="text-gray-500 mb-2">No invoices generated for this term yet.</p>
          <p className="text-sm text-gray-400 mb-4">
            {studentsWithoutInvoicesTotal} active {studentsWithoutInvoicesTotal === 1 ? 'student' : 'students'} ready to be invoiced
          </p>
          {!isClosed && canManageInvoices && (
            <button
              onClick={() => setGeneratePanelOpen(true)}
              disabled={generatePanelOpen && !!runningGeneration}
              title={runningGeneration && !generatePanelOpen ? 'Generation is already running — click to view its progress' : undefined}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
            >
              {runningGeneration
                ? `Generating… (${runningGeneration.processed}/${runningGeneration.total || '?'})`
                : 'Generate invoices'}
            </button>
          )}
        </div>
      )}

      {/* Invoices table */}
      {(invoices.length > 0 || studentsWithoutInvoices.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Invoice #</th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Student</th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Class</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Total</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Paid</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Outstanding</th>
                <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map(inv => {
                const b = statusBadge(inv)
                return (
                  <tr 
                    key={inv.id}
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="py-3 px-4 text-sm text-gray-500">
                      {inv.invoiceNumber || '—'}
                    </td>
                    <td className="py-3 px-4 text-sm text-navy font-medium">
                      {inv.studentFirstName} {inv.studentLastName}
                      <p className="text-xs text-gray-500 mt-0.5">#{inv.studentAdmissionNumber}</p>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-700">{inv.className}</td>
                    <td className="py-3 px-4 text-sm text-right text-navy">
                      {formatNaira(inv.totalAmount)}
                      {inv.previousBalance > 0 && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          incl. {formatNaira(inv.previousBalance)} prev. balance
                        </p>
                      )}
                      {inv.creditApplied > 0 && (
                        <p className="text-xs text-mint mt-0.5">
                          − {formatNaira(inv.creditApplied)} credit
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-right">
                      <span className={inv.paidAmount > 0 ? 'text-mint font-medium' : 'text-gray-400'}>
                        {formatNaira(inv.paidAmount)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-right">
                      <span className={inv.outstandingAmount > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                        {formatNaira(inv.outstandingAmount)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${b.cls}`}>
                          {b.label}
                        </span>
                        {inv.needsResend && canManageInvoices && (
                          notifiedIds.has(inv.id) ? (
                            <span className="text-xs text-mint font-medium">Notified</span>
                          ) : inv.carriedForwardToCycleName ? (
                            <span className="text-xs text-gray-400" title={`This balance carried forward to ${inv.carriedForwardToCycleName}`}>
                              Carried forward to {inv.carriedForwardToCycleName}
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleNotifyUpdate(inv.id)
                              }}
                              disabled={notifyingId === inv.id}
                              className="text-xs text-mint font-medium hover:underline disabled:opacity-50"
                            >
                              {notifyingId === inv.id ? 'Sending...' : 'Notify parent of update'}
                            </button>
                          )
                        )}
                        {inv.needsRegeneration && (
                          <>
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800">
                              out of date
                            </span>
                            {canManageInvoices && (
                              inv.regenerationBlocked ? (
                                <span
                                  className="text-xs text-gray-400"
                                  title="This change would drop the total below what's already been paid — that needs a manual refund/credit reconciliation, not a regenerate."
                                >
                                  Locked
                                </span>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleRegenerateOne(inv.id)
                                  }}
                                  disabled={regeneratingId === inv.id}
                                  className="text-xs text-mint font-medium hover:underline disabled:opacity-50"
                                >
                                  {regeneratingId === inv.id ? 'Regenerating...' : 'Regenerate'}
                                </button>
                              )
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {studentsWithoutInvoices.map(s => (
                <tr
                  key={s.id}
                  onClick={() => router.push(`/students/${s.id}?tab=fees`)}
                  className="cursor-pointer hover:bg-gray-50 bg-red-50/30"
                >
                  <td className="py-3 px-4 text-sm text-gray-400">—</td>
                  <td className="py-3 px-4 text-sm text-navy font-medium">
                    {s.firstName} {s.lastName}
                    <p className="text-xs text-gray-500 mt-0.5">#{s.admissionNumber}</p>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-700">
                    {s.className || <span className="text-red-600">No class</span>}
                  </td>
                  <td colSpan={3} className="py-3 px-4 text-sm text-gray-400 italic text-center">
                    No invoice yet
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                      no invoice
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {invoicesTotal > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center gap-3 justify-between text-sm">
              <div className="flex items-center gap-4">
                <p className="text-gray-500">
                  Showing {rangeStart}-{rangeEnd} of {invoicesTotal} invoices
                </p>
                <label className="flex items-center gap-1.5 text-gray-500">
                  <span className="hidden sm:inline">Per page</span>
                  <select
                    value={perPage}
                    onChange={(e) => navigate({ perPage: e.target.value, page: '1' })}
                    className="px-2 py-1 border border-gray-200 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                  >
                    {CYCLE_INVOICES_PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigate({ page: String(page - 1) })}
                    disabled={page <= 1}
                    className="px-3 py-1 text-sm text-gray-700 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← Previous
                  </button>
                  {getPageNumbers(page, totalPages).map((p, index) => (
                    p === '...' ? (
                      <span key={`ellipsis-${index}`} className="px-2 text-gray-400">...</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => navigate({ page: String(p) })}
                        className={`min-w-[32px] px-2 py-1 text-sm rounded ${
                          page === p
                            ? 'bg-navy text-white font-medium'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  ))}
                  <button
                    onClick={() => navigate({ page: String(page + 1) })}
                    disabled={page >= totalPages}
                    className="px-3 py-1 text-sm text-gray-700 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {generatePanelOpen && (
        <GenerateInvoicesPanel
          cycleId={cycle.id}
          onClose={() => setGeneratePanelOpen(false)}
          onSuccess={() => {
            setGeneratePanelOpen(false)
            router.refresh()
          }}
        />
      )}
    </>
  )
}