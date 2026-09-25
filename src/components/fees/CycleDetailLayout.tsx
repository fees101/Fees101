'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { CycleDetailData, CycleInvoiceFilter, InvoiceRow, CycleRow, SessionRow } from '@/lib/queries/fees'
import GenerateInvoicesPanel from './GenerateInvoicesPanel'
import CreateTermPanel from './CreateTermPanel'
import CarryForwardSummaryModal from './CarryForwardSummaryModal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import { regenerateInvoice, startInvoiceRegenerationJob, activateTerm, deleteTermDraft, reopenTermAsDraft } from '@/app/(app)/fees/cycles/actions'
import { sendInvoiceUpdateNotice } from '@/app/(app)/money/invoices/actions'
import { useActiveJobs, useTrackedJob, useOnJobOpenRequested } from '@/lib/jobs/ActiveJobsProvider'
import { useCan } from '@/lib/auth/PermissionsProvider'
import { formatDate } from '@/lib/format/date'
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'
import Toast from '@/components/ui/Toast'

interface Props {
  data: CycleDetailData
  cycles: CycleRow[]
  sessions: SessionRow[]
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

// Collected is bucketed by payment date across the whole school, so a term that
// billed little but sat in a busy collection window can read well over 100%.
// Cap the rate so an outlier can't render a broken-looking figure; the real
// naira totals are shown alongside it.
function collectedRate(collected: number, expected: number): string {
  if (expected <= 0) return '0%'
  const pct = Math.round((collected / expected) * 100)
  return pct > 999 ? '>999%' : `${pct}%`
}

function getPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (currentPage <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (currentPage >= totalPages - 2) {
    return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

// Status as colour-carrying text, no pills: green only where money is fully
// in, ochre for anything still needing a human, muted neutral for inert.
function invoiceState(inv: InvoiceRow): { label: string; color: string } {
  // Cancelled overrides everything — a dead invoice never reads as "needs
  // resend" just because that flag happened to be set at cancellation time.
  if (inv.status === 'cancelled') return { label: 'CANCELLED', color: 'var(--color-neutral-500)' }
  if (inv.needsResend) return { label: 'NEEDS RESEND', color: 'var(--color-ochre-text)' }
  if (inv.status === 'paid') return { label: 'PAID', color: 'var(--color-ledger)' }
  if (inv.status === 'partial') return { label: 'PARTIAL', color: 'var(--color-ochre-text)' }
  if (inv.status === 'overdue') return { label: 'OVERDUE', color: 'var(--color-ochre-text)' }
  return { label: 'UNPAID', color: 'var(--color-neutral-500)' }
}

function cycleState(status: 'draft' | 'active' | 'closed'): { label: string; color: string } {
  if (status === 'active') return { label: 'ACTIVE', color: 'var(--color-ink)' }
  if (status === 'draft') return { label: 'DRAFT', color: 'var(--color-ochre-text)' }
  return { label: 'CLOSED', color: 'var(--color-neutral-500)' }
}

export default function CycleDetailLayout({ data, cycles, sessions, showFinancials = true, schoolId }: Props) {
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
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)
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

  // Term-lifecycle controls, available from a term's own page so a draft can be
  // prepared and activated (and an active term reopened) without going back to
  // the Cycles list. The server actions are the single source of truth; this is
  // the same confirm-then-act flow as the list, just scoped to this one term.
  // The activate/reopen/delete logic is deliberately duplicated from
  // CyclesLayout rather than extracted into a shared hook: both surfaces are
  // still awaiting the user's own test pass, so keeping the tested list code
  // untouched matters more here than DRY. A useTermActions extraction is noted
  // in ROADMAP as a follow-up once both are signed off.
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    destructive?: boolean
    confirmLabel?: string
    onConfirm: () => Promise<void>
  } | null>(null)
  // Undo-activation and delete-draft both destroy real state, so they use the
  // itemized DestructiveConfirmModal rather than the plain ConfirmDialog above
  // (mirrors CyclesLayout — see the duplication note above).
  const [destructiveAction, setDestructiveAction] = useState<
    { type: 'undo-activation' | 'delete-draft'; cycle: CycleRow } | null
  >(null)
  const [destructiveBusy, setDestructiveBusy] = useState(false)
  const [destructiveError, setDestructiveError] = useState<string | null>(null)
  const [carryForwardSummary, setCarryForwardSummary] = useState<{
    mode: 'activated' | 'closed'
    closedTermName: string | null
    invoicesUpdated: number
    invoicesNeedingResend: number
    studentsWithCarryForward: number
    totalCarryForward: number
  } | null>(null)
  const [editPanelOpen, setEditPanelOpen] = useState(false)

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
      ? ` (${lockedCount} ${lockedCount === 1 ? 'invoice was' : 'invoices were'} left untouched, would drop below what's already been paid)`
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
            `Cancelled - ${job.processed} ${job.processed === 1 ? 'invoice' : 'invoices'} updated before stopping.${lockedNote}${failedNote}`
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

  // A term-close (triggered implicitly when activating over an existing active
  // term) can spin off a background job to carry balances forward. Surface it in
  // the floating job chip so the user can watch it finish, same as the list.
  function trackCloseTermJobIfAny(jobId: string | null | undefined, totalInvoices: number) {
    if (!jobId) return
    trackJob(jobId, 'close_term', 'Carrying forward balances', { total: totalInvoices }, undefined, { href: '/fees/cycles' })
  }

  function handleActivate(cycleRow: CycleRow) {
    setError(null)
    // Guard: activating a term from a past academic year would make the school's
    // "active" term jump backwards in time. Match the list's guard exactly.
    const activeSession = sessions.find(s => s.status === 'active')
    const cycleSession = cycleRow.sessionId ? sessions.find(s => s.id === cycleRow.sessionId) : undefined
    if (activeSession && cycleSession && cycleSession.id !== activeSession.id && cycleSession.startDate < activeSession.startDate) {
      setError(`"${cycleRow.name}" belongs to "${cycleSession.name}", a past academic year. Terms from past years can't be activated.`)
      return
    }
    const currentlyActive = cycles.find(c => c.status === 'active')

    // Same routing as the Cycles list page: activating closes whatever term
    // is currently live as a side effect, so send the admin through the real
    // Close term review flow first instead of doing it invisibly inside a
    // confirm dialog. ?activateAfter tells that page to activate this draft
    // once the close completes.
    if (currentlyActive && currentlyActive.id !== cycleRow.id) {
      router.push(`/fees/close-term?cycle=${currentlyActive.id}&activateAfter=${cycleRow.id}`)
      return
    }

    setConfirmDialog({
      title: 'Activate this term?',
      message: `Make "${cycleRow.name}" the active term.`,
      confirmLabel: 'Activate',
      onConfirm: async () => {
        const result = await activateTerm(cycleRow.id)
        if (result.error) {
          setError(result.error)
          setToast({ ok: false, message: result.error })
        } else if (result.summary && result.summary.closedTermName) {
          setCarryForwardSummary({ mode: 'activated', ...result.summary })
          trackCloseTermJobIfAny(result.summary.jobId, result.summary.invoicesUpdated)
          setToast({ ok: true, message: `${cycleRow.name} activated.` })
          router.refresh()
        } else {
          setToast({ ok: true, message: `${cycleRow.name} activated.` })
          router.refresh()
        }
        setConfirmDialog(null)
      },
    })
  }

  function handleReopenAsDraft(cycleRow: CycleRow) {
    setError(null)
    setDestructiveError(null)
    setDestructiveAction({ type: 'undo-activation', cycle: cycleRow })
  }

  function handleDeleteDraft(cycleRow: CycleRow) {
    setError(null)
    setDestructiveError(null)
    setDestructiveAction({ type: 'delete-draft', cycle: cycleRow })
  }

  async function handleDestructiveConfirm() {
    if (!destructiveAction) return
    const { type, cycle: cycleRow } = destructiveAction
    setDestructiveBusy(true)
    setDestructiveError(null)
    if (type === 'undo-activation') {
      const result = await reopenTermAsDraft(cycleRow.id)
      setDestructiveBusy(false)
      if (result.error) {
        setDestructiveError(result.error)
        return
      }
      setDestructiveAction(null)
      setToast({ ok: true, message: `${cycleRow.name} reopened as draft.` })
      router.refresh()
      return
    }
    const result = await deleteTermDraft(cycleRow.id)
    setDestructiveBusy(false)
    if (result.error) {
      setDestructiveError(result.error)
      return
    }
    // We're on the page for the term we just deleted, so there's nothing
    // left to show here — return to the list.
    router.push('/fees/cycles')
  }

  if (!cycle) {
    return (
      <div className="border-2 border-dashed border-[var(--color-neutral-300)] p-12 text-center">
        <p className="text-[var(--color-neutral-700)]">Term not found.</p>
      </div>
    )
  }

  const isClosed = cycle.status === 'closed'
  const isDraft = cycle.status === 'draft'
  const isActive = cycle.status === 'active'
  // The list-shaped row for this term (getAllCycles), carrying fields the detail
  // fetch doesn't — feeItemCount and invoicesSent — and the shape the term
  // actions + CreateTermPanel expect. Should always resolve; guarded anyway.
  const cycleRow = cycles.find(c => c.id === cycle.id) ?? null
  // cycle.invoiceCount reflects the whole cycle, not just the current page/
  // filter — this is "does the cycle have invoices at all", used to decide
  // between the print-all/generate-more affordances and the fully-empty state.
  const hasInvoices = cycle.invoiceCount > 0

  const totalPages = Math.max(1, Math.ceil(invoicesTotal / perPage))
  const rangeStart = invoicesTotal === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, invoicesTotal)
  // studentsWithoutInvoices is unpaginated (see getCycleDetailById), so it's
  // only rendered on the invoice list's last page — otherwise it would repeat
  // in full on every page and the footer count would never reconcile with
  // what's on screen.
  const showNoInvoiceRows = page >= totalPages
  const noInvoiceShown = showNoInvoiceRows ? studentsWithoutInvoices.length : 0

  // Draft "Prepare this term" surface: the real order of operations before a
  // term goes live — dates first, then fees, optionally draft invoices, then
  // activate. Echoes the mockup's lifecycle-step pattern (number · title/body ·
  // action), tailored to a draft since the canvas designs only the active-term
  // lifecycle. Close term and year-end are intentionally absent here — they
  // don't apply until the term is active.
  const prepareSteps: {
    n: string
    title: string
    body: string
    action: { label: string; href?: string; onClick?: () => void; variant: 'primary' | 'outline'; disabled?: boolean } | null
  }[] = isDraft ? [
    {
      n: '01',
      title: "Set the term's dates",
      body: cycle.startDate && cycle.endDate
        ? `Runs ${formatDate(cycle.startDate)} to ${formatDate(cycle.endDate)}${cycle.dueDate ? `, payment due ${formatDate(cycle.dueDate)}` : ''}. Edit the schedule, name or session anytime before activating.`
        : 'Add the start, end and payment due dates so invoices and reminders line up.',
      action: canManageFeeStructure ? { label: 'Edit details', onClick: () => setEditPanelOpen(true), variant: 'outline' } : null,
    },
    {
      n: '02',
      title: "Set this term's fees",
      body: cycleRow && cycleRow.feeItemCount > 0
        ? `${cycleRow.feeItemCount} ${cycleRow.feeItemCount === 1 ? 'fee is' : 'fees are'} set for this term. Adjust prices or add more before you activate.`
        : 'No fees yet. Add them so invoices have something to bill.',
      action: canManageFeeStructure ? { label: 'Edit fees', href: `/fees/structure?cycle=${cycle.id}&from=${encodeURIComponent(`/fees/cycles/${cycle.id}`)}`, variant: 'outline' } : null,
    },
    {
      n: '03',
      title: 'Draft invoices in advance',
      body: 'Optional. Generate them now to print into report cards before the term starts. Nothing is sent to parents while the term is a draft.'
        + (cycle.invoiceCount > 0 ? ` ${cycle.invoiceCount} drafted so far.` : ''),
      action: canManageInvoices ? {
        label: runningGeneration ? `Generating... (${runningGeneration.processed}/${runningGeneration.total || '?'})` : 'Generate draft invoices',
        onClick: () => setGeneratePanelOpen(true),
        variant: 'outline',
        disabled: (studentsWithoutInvoicesTotal === 0 && !runningGeneration) || (generatePanelOpen && !!runningGeneration),
      } : null,
    },
    {
      n: '04',
      title: 'Activate when the term begins',
      body: 'Activating lets you send invoices and start collecting. If another term is active, it will be closed and any unpaid balances carried forward.',
      action: canManageFeeStructure ? { label: 'Activate term', onClick: () => { if (cycleRow) handleActivate(cycleRow) }, variant: 'primary' } : null,
    },
  ] : []

  return (
    <>
      {/* Sub-header: status + dates + actions (title/back are handled by WorkspaceHeader) */}
      <div className="mb-6 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.08em', color: cycleState(cycle.status).color }}>
            {cycleState(cycle.status).label}
          </span>
          <p className="text-sm text-[var(--color-neutral-700)] mt-2">
            {formatDate(cycle.startDate)} &ndash; {formatDate(cycle.endDate)}
            <span className="text-[var(--color-neutral-500)]"> &middot; </span>
            {isClosed && cycle.closedAt ? `Closed: ${formatDate(cycle.closedAt)}` : `Due: ${formatDate(cycle.dueDate)}`}
            {cycle.sessionName && (
              <>
                <span className="text-[var(--color-neutral-500)]"> &middot; </span>
                Session: {cycle.sessionName}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isActive && canManageFeeStructure && (
            <Link href={`/fees/structure?cycle=${cycle.id}&from=${encodeURIComponent(`/fees/cycles/${cycle.id}`)}`} className="text-[13px] font-semibold hover:underline text-[var(--color-ink)]">
              Edit fees
            </Link>
          )}
          {hasInvoices && (
            <a href={`/api/cycles/${cycle.id}/pdf`} download className="text-[13px] font-semibold hover:underline text-[var(--color-ink)]">
              Print all invoices ({cycle.invoiceCount})
            </a>
          )}
          {isActive && canManageInvoices && (
            <button
              onClick={() => setGeneratePanelOpen(true)}
              disabled={(studentsWithoutInvoicesTotal === 0 && !runningGeneration) || (generatePanelOpen && !!runningGeneration)}
              title={runningGeneration && !generatePanelOpen ? 'Generation is already running, click to view its progress' : undefined}
              className="m-btn m-btn-primary"
            >
              {runningGeneration
                ? `Generating... (${runningGeneration.processed}/${runningGeneration.total || '?'})`
                : hasInvoices ? `Generate for ${studentsWithoutInvoicesTotal} new` : `Generate invoices`}
            </button>
          )}
        </div>
      </div>

      {/* Active: quick term management. Closing and year-end live on their own
          tabs (the redesign deliberately un-buried them), so we route to the
          close-term ledger rather than re-embedding it here. */}
      {isActive && canManageFeeStructure && (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          {cycleRow && cycleRow.canUndoActivation && (
            <button onClick={() => handleReopenAsDraft(cycleRow)} className="font-semibold text-[var(--color-neutral-700)] hover:underline">
              Undo activation
            </button>
          )}
          <Link href={`/fees/close-term?cycle=${cycle.id}`} className="font-semibold text-[var(--color-ink)] hover:underline">
            Review close term
          </Link>
        </div>
      )}

      {/* Draft: the prepare surface — set fees, optionally draft invoices, then
          activate. No close/year-end here; they don't apply until active. */}
      {isDraft && (
        <section className="mb-6" style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 20 }}>
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
            <h2 className="text-[22px] font-extrabold text-[var(--color-ink)]" style={{ margin: 0 }}>Prepare this term</h2>
            <span className="text-[12px] font-semibold text-[var(--color-ochre-text)]" style={{ letterSpacing: '0.08em' }}>DRAFT</span>
          </div>
          <p className="text-[14px] text-[var(--color-neutral-700)] mb-5" style={{ maxWidth: '70ch' }}>
            This term isn&apos;t billing yet. Set its fees, optionally draft invoices to print into report cards, then activate it when the term begins. Closing the term and year-end only apply once it&apos;s active.
          </p>
          {prepareSteps.map(s => (
            <div
              key={s.n}
              className="grid items-start"
              style={{ gridTemplateColumns: '34px minmax(0,1fr) auto', gap: 16, padding: '16px 0', borderBottom: '1px solid var(--color-neutral-300)' }}
            >
              <span className="m-num text-[13px] font-extrabold text-[var(--color-ink)]" style={{ paddingTop: 2 }}>{s.n}</span>
              <div style={{ minWidth: 0 }}>
                <p className="text-[16px] font-bold text-[var(--color-ink)]" style={{ margin: '0 0 3px' }}>{s.title}</p>
                <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: 0, lineHeight: 1.5 }}>{s.body}</p>
              </div>
              <div className="text-right">
                {s.action && (
                  s.action.variant === 'primary' ? (
                    s.action.href ? (
                      <Link href={s.action.href} className="m-btn m-btn-primary m-btn-sm">
                        {s.action.label}
                      </Link>
                    ) : (
                      <button
                        onClick={s.action.onClick}
                        disabled={s.action.disabled}
                        className="m-btn m-btn-primary m-btn-sm"
                      >
                        {s.action.label}
                      </button>
                    )
                  ) : (
                    s.action.href ? (
                      <Link href={s.action.href} className="text-[13px] font-semibold hover:underline text-[var(--color-ink)]">
                        {s.action.label}
                      </Link>
                    ) : (
                      <button
                        onClick={s.action.onClick}
                        disabled={s.action.disabled}
                        className="text-[13px] font-semibold hover:underline text-[var(--color-ink)] disabled:opacity-40 disabled:no-underline"
                      >
                        {s.action.label}
                      </button>
                    )
                  )
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-[13px]">
            {canManageFeeStructure && cycleRow && (
              <button onClick={() => handleDeleteDraft(cycleRow)} className="font-semibold text-[var(--color-signal-text)] hover:underline">
                Delete draft
              </button>
            )}
          </div>
        </section>
      )}

      {/* Closed: read-only, no recap section (the KPIs + invoice table below
          already carry the money-level record). No reopen offered — the
          server forbids reopening a closed term, so we don't surface an
          action that would only error. */}
      {isClosed && (
        <section className="mb-6" style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 20 }}>
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
            <span className="text-[12px] font-semibold text-[var(--color-neutral-500)]" style={{ letterSpacing: '0.08em' }}>
              CLOSED{cycle.closedAt ? ` · ${formatDate(cycle.closedAt)}` : ''}
            </span>
          </div>
          <p className="text-[14px] text-[var(--color-neutral-700)]" style={{ maxWidth: '70ch' }}>
            This term is closed and read-only. No new invoices or edits, but payments can still be recorded against the outstanding balances shown below.
          </p>
        </section>
      )}

      {!isClosed && (totalsByStatus.needsRegeneration > 0 || regeneratingAll) && (
        <div className="mb-4 pl-4 py-3 border-l-2 border-[var(--color-ochre)] flex flex-col sm:flex-row sm:items-start gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--color-ink)]">
              {totalsByStatus.needsRegeneration} {totalsByStatus.needsRegeneration === 1 ? 'invoice is' : 'invoices are'} out of date
            </p>
            <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">
              Fees, opt-ins, or exemptions changed since these were generated. Regenerate to apply the current numbers, payments already made are preserved.
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
              className="m-btn m-btn-primary m-btn-sm"
            >
              {regeneratingAll
                ? `Regenerating... ${regenerateJob?.processed ?? 0}/${regenerateJob?.total ?? 0}`
                : 'Regenerate all'}
            </button>
            {regeneratingAll && regenerateJobId && (
              <button
                onClick={() => cancelJob(regenerateJobId)}
                disabled={regenerateJob?.cancelling}
                className="text-xs text-[var(--color-signal-text)] hover:underline disabled:opacity-50 disabled:no-underline"
              >
                {regenerateJob?.cancelling ? 'Cancelling...' : 'Cancel'}
              </button>
            )}
          </div>
          )}
        </div>
      )}

      {runningGeneration && !generatePanelOpen && (
        <div className="mb-4 border border-[var(--color-neutral-300)] p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm text-[var(--color-ink)]">
              Generating invoices in the background - {runningGeneration.processed}/{runningGeneration.total || '?'}
            </p>
            <button
              onClick={() => setGeneratePanelOpen(true)}
              className="text-sm font-medium text-[var(--color-ink)] hover:underline flex-shrink-0"
            >
              View
            </button>
          </div>
          <div className="m-loading" />
        </div>
      )}

      {regenerateSummary && (
        <div className="mb-4 pl-3 py-2 border-l-2 border-[var(--color-ink)] text-sm text-[var(--color-ink)] flex items-center justify-between gap-3">
          {regenerateSummary}
          <button onClick={() => setRegenerateSummary(null)} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)] flex-shrink-0" aria-label="Dismiss">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 pl-3 py-2 border-l-2 border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className={`grid grid-cols-2 gap-4 mb-6 ${showFinancials ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <div className="border-t-2 border-[var(--color-ink)] pt-4">
          <p className="text-xs text-[var(--color-neutral-700)] mb-1">Invoices</p>
          {/* Show the invoice count as a plain number, not a "count / students"
              ratio. invoiceCount is every invoice in the cycle (it can include
              invoices for students who have since withdrawn), while the student
              figures below count only active students — so a ratio between them
              never cleanly reconciles and can even read over 100%. The actionable
              coverage signal is "how many active students still have no invoice",
              which is what the line beneath carries. */}
          <p className="text-2xl font-bold text-[var(--color-ink)] m-num">
            {cycle.invoiceCount}
          </p>
          {studentsWithoutInvoicesTotal > 0 ? (
            <p className="text-xs text-[var(--color-ochre-text)] mt-1">{studentsWithoutInvoicesTotal} students missing</p>
          ) : (
            <p className="text-xs text-[var(--color-neutral-500)] mt-1">All {totalActiveStudents} students invoiced</p>
          )}
        </div>
        {showFinancials && (
          <div className="border-t-2 border-[var(--color-ink)] pt-4">
            <p className="text-xs text-[var(--color-neutral-700)] mb-1">Expected</p>
            <p className="text-2xl font-bold text-[var(--color-ink)] m-num">{formatNaira(cycle.totalExpected)}</p>
          </div>
        )}
        <div className="border-t-2 border-[var(--color-ink)] pt-4">
          <p className="text-xs text-[var(--color-neutral-700)] mb-1">Collected</p>
          <p className="text-2xl font-bold text-[var(--color-ledger)] m-num">
            {showFinancials
              ? formatNaira(cycle.totalCollected)
              : collectedRate(cycle.totalCollected, cycle.totalExpected)}
          </p>
          {cycle.totalExpected > 0 && (
            <p className="text-xs text-[var(--color-neutral-700)] mt-1">
              {showFinancials ? `${collectedRate(cycle.totalCollected, cycle.totalExpected)} collected` : 'of expected'}
              {cycle.invoiceCount > 0 && ` · ${totalsByStatus.paid}/${cycle.invoiceCount} paid up`}
            </p>
          )}
        </div>
        <div className="border-t-2 border-[var(--color-ink)] pt-4">
          <p className="text-xs text-[var(--color-neutral-700)] mb-1">Outstanding</p>
          <p className="text-2xl font-bold text-[var(--color-ochre-text)] m-num">
            {showFinancials
              ? formatNaira(cycle.totalOutstanding)
              : `${cycle.totalExpected > 0 ? Math.round((cycle.totalOutstanding / cycle.totalExpected) * 100) : 0}%`}
          </p>
          <p className="text-xs text-[var(--color-neutral-700)] mt-1">
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
            className={`px-3 py-1.5 text-xs font-semibold border ${filter === 'all' ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]' : 'bg-[var(--color-paper)] text-[var(--color-neutral-700)] border-[var(--color-neutral-300)] hover:border-[var(--color-ink)]'}`}
          >
            All {cycle.invoiceCount + studentsWithoutInvoicesTotal}
          </button>
          <button
            onClick={() => setFilter('paid')}
            className={`px-3 py-1.5 text-xs font-semibold border ${filter === 'paid' ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]' : 'bg-[var(--color-paper)] text-[var(--color-neutral-700)] border-[var(--color-neutral-300)] hover:border-[var(--color-ink)]'}`}
          >
            Paid {totalsByStatus.paid}
          </button>
          <button
            onClick={() => setFilter('partial')}
            className={`px-3 py-1.5 text-xs font-semibold border ${filter === 'partial' ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]' : 'bg-[var(--color-paper)] text-[var(--color-neutral-700)] border-[var(--color-neutral-300)] hover:border-[var(--color-ink)]'}`}
          >
            Partial {totalsByStatus.partial}
          </button>
          <button
            onClick={() => setFilter('unpaid')}
            className={`px-3 py-1.5 text-xs font-semibold border ${filter === 'unpaid' ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]' : 'bg-[var(--color-paper)] text-[var(--color-neutral-700)] border-[var(--color-neutral-300)] hover:border-[var(--color-ink)]'}`}
          >
            Unpaid {totalsByStatus.pending + totalsByStatus.overdue}
          </button>
          {totalsByStatus.needsResend > 0 && (
            <button
              onClick={() => setFilter('needs_resend')}
              className={`px-3 py-1.5 text-xs font-semibold border ${filter === 'needs_resend' ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]' : 'bg-[var(--color-paper)] text-[var(--color-ochre-text)] border-[var(--color-neutral-300)] hover:border-[var(--color-ink)]'}`}
            >
              Needs resend {totalsByStatus.needsResend}
            </button>
          )}
          {totalsByStatus.needsRegeneration > 0 && (
            <button
              onClick={() => setFilter('out_of_date')}
              className={`px-3 py-1.5 text-xs font-semibold border ${filter === 'out_of_date' ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]' : 'bg-[var(--color-paper)] text-[var(--color-ochre-text)] border-[var(--color-neutral-300)] hover:border-[var(--color-ink)]'}`}
            >
              Out of date {totalsByStatus.needsRegeneration}
            </button>
          )}
          {studentsWithoutInvoicesTotal > 0 && (
            <button
              onClick={() => setFilter('no_invoice')}
              className={`px-3 py-1.5 text-xs font-semibold border ${filter === 'no_invoice' ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]' : 'bg-[var(--color-paper)] text-[var(--color-signal-text)] border-[var(--color-neutral-300)] hover:border-[var(--color-ink)]'}`}
            >
              No invoice {studentsWithoutInvoicesTotal}
            </button>
          )}
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or admission #"
            className="m-input ml-auto w-full sm:w-64"
          />
        </div>
      )}

      {/* Empty state */}
      {!hasInvoices && studentsWithoutInvoicesTotal === 0 && (
        <div className="py-12 border-t-2 border-[var(--color-ink)]" style={{ maxWidth: '60ch' }}>
          <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">No students in this term yet</p>
          <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)] mb-4">
            There is no one to invoice until the roster has active students. Add them first, then generate
            invoices for the term.
          </p>
          <Link href="/students" className="m-btn m-btn-primary">Add students</Link>
        </div>
      )}

      {!hasInvoices && studentsWithoutInvoicesTotal > 0 && (
        <div className="py-12 border-t-2 border-[var(--color-ink)]" style={{ maxWidth: '60ch' }}>
          <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">No invoices for this term</p>
          <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)] mb-4">
            {cycle.invoicesGeneratedAt
              ? `Generation ran on ${formatDate(cycle.invoicesGeneratedAt)} but produced no invoices — check exemptions and opt-outs. ${studentsWithoutInvoicesTotal} active ${studentsWithoutInvoicesTotal === 1 ? 'student is' : 'students are'} still ready to be invoiced.`
              : `Generation has not run yet. ${studentsWithoutInvoicesTotal} active ${studentsWithoutInvoicesTotal === 1 ? 'student is' : 'students are'} ready to be invoiced.`}
          </p>
          {!isClosed && canManageInvoices && (
            <button
              onClick={() => setGeneratePanelOpen(true)}
              disabled={generatePanelOpen && !!runningGeneration}
              title={runningGeneration && !generatePanelOpen ? 'Generation is already running, click to view its progress' : undefined}
              className="m-btn m-btn-primary"
            >
              {runningGeneration
                ? `Generating... (${runningGeneration.processed}/${runningGeneration.total || '?'})`
                : 'Generate invoices'}
            </button>
          )}
        </div>
      )}

      {/* Invoices table */}
      {(invoices.length > 0 || studentsWithoutInvoices.length > 0) && (
        <div className="border border-[var(--color-neutral-300)]">
          <div className="overflow-x-auto">
          <table className="m-table min-w-[880px]">
            <thead>
              <tr>
                <th className="text-left">Invoice #</th>
                <th className="text-left">Student</th>
                <th className="text-left">Class</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Outstanding</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr
                  key={inv.id}
                  onClick={() => router.push(`/money/invoices/${inv.id}`)}
                  className="cursor-pointer"
                >
                  <td className="text-sm text-[var(--color-neutral-500)]">
                    {inv.invoiceNumber || '-'}
                  </td>
                  <td className="text-sm text-[var(--color-ink)] font-medium">
                    {inv.studentFirstName} {inv.studentLastName}
                    <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">#{inv.studentAdmissionNumber}</p>
                  </td>
                  <td className="text-sm text-[var(--color-neutral-700)]">{inv.className}</td>
                  <td className="text-sm text-right text-[var(--color-ink)] m-num">
                    {formatNaira(inv.totalAmount)}
                    {inv.previousBalance > 0 && (
                      <p className="text-xs text-[var(--color-ochre-text)] mt-0.5">
                        incl. {formatNaira(inv.previousBalance)} prev. balance
                      </p>
                    )}
                    {inv.creditApplied > 0 && (
                      <p className="text-xs text-[var(--color-ledger)] mt-0.5">
                        &minus; {formatNaira(inv.creditApplied)} credit
                      </p>
                    )}
                  </td>
                  <td className="text-sm text-right m-num">
                    <span className={inv.paidAmount > 0 ? 'text-[var(--color-ledger)] font-medium' : 'text-[var(--color-neutral-500)]'}>
                      {formatNaira(inv.paidAmount)}
                    </span>
                  </td>
                  <td className="text-sm text-right m-num">
                    <span className={inv.outstandingAmount > 0 ? 'text-[var(--color-ochre-text)] font-medium' : 'text-[var(--color-neutral-500)]'}>
                      {formatNaira(inv.outstandingAmount)}
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.08em', color: invoiceState(inv).color }}>
                        {invoiceState(inv).label}
                      </span>
                      {inv.needsResend && canManageInvoices && (
                        notifiedIds.has(inv.id) ? (
                          <span className="text-xs text-[var(--color-ink)] font-medium">Notified</span>
                        ) : inv.carriedForwardToCycleName ? (
                          <span className="text-xs text-[var(--color-neutral-500)]" title={`This balance carried forward to ${inv.carriedForwardToCycleName}`}>
                            Carried forward to {inv.carriedForwardToCycleName}
                          </span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleNotifyUpdate(inv.id)
                            }}
                            disabled={notifyingId === inv.id}
                            className="text-xs text-[var(--color-ink)] font-medium hover:underline disabled:opacity-50"
                          >
                            {notifyingId === inv.id ? 'Sending...' : 'Notify parent of update'}
                          </button>
                        )
                      )}
                      {inv.needsRegeneration && (
                        <>
                          <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.08em', color: 'var(--color-ochre-text)' }}>
                            OUT OF DATE
                          </span>
                          {canManageInvoices && (
                            inv.regenerationBlocked ? (
                              <span
                                className="text-xs text-[var(--color-neutral-500)]"
                                title="This change would drop the total below what's already been paid, that needs a manual refund/credit reconciliation, not a regenerate."
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
                                className="text-xs text-[var(--color-ink)] font-medium hover:underline disabled:opacity-50"
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
              ))}
              {showNoInvoiceRows && studentsWithoutInvoices.map(s => (
                <tr
                  key={s.id}
                  onClick={() => router.push(`/students/${s.id}?tab=fees`)}
                  className="cursor-pointer bg-[color-mix(in_srgb,var(--color-signal)_5%,transparent)]"
                >
                  <td className="text-sm text-[var(--color-neutral-500)]">-</td>
                  <td className="text-sm text-[var(--color-ink)] font-medium">
                    {s.firstName} {s.lastName}
                    <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">#{s.admissionNumber}</p>
                  </td>
                  <td className="text-sm text-[var(--color-neutral-700)]">
                    {s.className || <span className="text-[var(--color-signal-text)]">No class</span>}
                  </td>
                  <td colSpan={3} className="text-sm text-[var(--color-neutral-500)] italic text-center">
                    No invoice yet
                  </td>
                  <td className="text-center">
                    <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.08em', color: 'var(--color-signal-text)' }}>
                      NO INVOICE
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {(invoicesTotal > 0 || noInvoiceShown > 0) && (
            <div className="px-4 py-3 border-t-2 border-[var(--color-ink)] flex flex-col sm:flex-row items-center gap-3 justify-between text-sm">
              <div className="flex items-center gap-4">
                <p className="text-[var(--color-neutral-700)] m-num">
                  {invoicesTotal > 0
                    ? <>Showing {rangeStart}-{rangeEnd} of {invoicesTotal} {invoicesTotal === 1 ? 'invoice' : 'invoices'}{noInvoiceShown > 0 && <> &middot; {noInvoiceShown} without an invoice</>}</>
                    : <>{noInvoiceShown} {noInvoiceShown === 1 ? 'student' : 'students'} without an invoice</>}
                </p>
                {invoicesTotal > 0 && (
                  <label className="flex items-center gap-2 text-[var(--color-neutral-700)]">
                    <span className="hidden sm:inline">Show</span>
                    <span className="flex items-center gap-2.5">
                      {CYCLE_INVOICES_PAGE_SIZE_OPTIONS.map(n => (
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
                )}
              </div>
              {invoicesTotal > 0 && totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigate({ page: String(page - 1) })}
                    disabled={page <= 1}
                    className="px-3 py-1 text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  {getPageNumbers(page, totalPages).map((p, index) => (
                    p === '...' ? (
                      <span key={`ellipsis-${index}`} className="px-2 text-[var(--color-neutral-500)]">...</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => navigate({ page: String(p) })}
                        className={`min-w-[32px] px-2 py-1 text-sm m-num ${
                          page === p
                            ? 'bg-[var(--color-ink)] text-[var(--color-paper)] font-medium'
                            : 'text-[var(--color-ink)] hover:bg-[var(--color-surface)]'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  ))}
                  <button
                    onClick={() => navigate({ page: String(page + 1) })}
                    disabled={page >= totalPages}
                    className="px-3 py-1 text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
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

      {/* Edit term details: the same panel the Cycles list uses to create/edit a
          term, rendered here so the edit happens in place on the term's own
          page. CreateTermPanel owns its own fixed overlay/backdrop/slide-over
          shell, so it's rendered directly without an extra wrapper. */}
      {editPanelOpen && cycleRow && (
        <CreateTermPanel
          mode="edit"
          cycles={cycles}
          sessions={sessions}
          editingCycle={cycleRow}
          onClose={() => setEditPanelOpen(false)}
          onSuccess={() => {
            setEditPanelOpen(false)
            router.refresh()
          }}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          destructive={confirmDialog.destructive}
          confirmLabel={confirmDialog.confirmLabel || 'Confirm'}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {destructiveAction && destructiveAction.type === 'undo-activation' && (
        <DestructiveConfirmModal
          eyebrow="This cannot be undone"
          title={`Undo activation of "${destructiveAction.cycle.name}"?`}
          description="Puts the term back to draft. Only use this for a term activated by mistake — it does not reopen the term that was closed when this one activated."
          rows={[
            { label: 'Invoices sent to parents', value: destructiveAction.cycle.invoicesSent },
            { label: 'Collected so far', value: formatNaira(destructiveAction.cycle.totalCollected), emphasize: true },
          ]}
          note="Blocked once any invoice on this term has been sent or paid, or it inherited a balance from the term it replaced."
          error={destructiveError}
          actions={[
            { label: 'Cancel', onClick: () => setDestructiveAction(null), variant: 'outline', disabled: destructiveBusy },
            { label: destructiveBusy ? 'Working...' : 'Undo activation', onClick: handleDestructiveConfirm, variant: 'danger', disabled: destructiveBusy },
          ]}
        />
      )}

      {destructiveAction && destructiveAction.type === 'delete-draft' && (
        <DestructiveConfirmModal
          eyebrow="This cannot be undone"
          title={`Delete draft "${destructiveAction.cycle.name}"?`}
          description="Permanently deletes this term, its fee items, and any draft invoices generated for it."
          rows={[
            { label: 'Fee items configured', value: destructiveAction.cycle.feeItemCount },
            { label: 'Draft invoices generated', value: destructiveAction.cycle.invoiceCount, emphasize: true },
          ]}
          note="Blocked if any invoice on this term has already been sent to a parent."
          error={destructiveError}
          actions={[
            { label: 'Cancel', onClick: () => setDestructiveAction(null), variant: 'outline', disabled: destructiveBusy },
            { label: destructiveBusy ? 'Deleting...' : 'Delete term', onClick: handleDestructiveConfirm, variant: 'danger', disabled: destructiveBusy },
          ]}
        />
      )}

      {carryForwardSummary && (
        <CarryForwardSummaryModal
          mode={carryForwardSummary.mode}
          closedTermName={carryForwardSummary.closedTermName}
          invoicesUpdated={carryForwardSummary.invoicesUpdated}
          invoicesNeedingResend={carryForwardSummary.invoicesNeedingResend}
          studentsWithCarryForward={carryForwardSummary.studentsWithCarryForward}
          totalCarryForward={carryForwardSummary.totalCarryForward}
          showFinancials={showFinancials}
          onClose={() => setCarryForwardSummary(null)}
        />
      )}

      {toast && <Toast message={toast.message} ok={toast.ok} onDismiss={() => setToast(null)} />}
    </>
  )
}
