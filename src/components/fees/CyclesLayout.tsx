'use client'

import { useState, useMemo, Fragment } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CycleRow, SessionRow } from '@/lib/queries/fees'
import CreateTermPanel from './CreateTermPanel'
import TermSelector from './TermSelector'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { activateTerm, deleteTermDraft, closeTerm, reopenTermAsDraft, previewCloseTerm } from '@/app/(app)/fees/cycles/actions'

interface Props {
  cycles: CycleRow[]
  sessions: SessionRow[]
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function statusBadge(status: 'draft' | 'active' | 'closed') {
  if (status === 'active') return { cls: 'bg-mint-light text-mint', dot: 'bg-mint' }
  if (status === 'draft') return { cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' }
  return { cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' }
}

function suggestNextSessionName(sessionName: string): string {
  const match = sessionName.match(/(\d{4})\s*\/\s*(\d{4})/)
  if (match) {
    return `${parseInt(match[1]) + 1}/${parseInt(match[2]) + 1}`
  }
  return 'a new session'
}

export default function CyclesLayout({ cycles, sessions }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [panelMode, setPanelMode] = useState<'create' | 'edit' | null>(null)
  const [editingCycle, setEditingCycle] = useState<CycleRow | null>(null)
  const [forceNewSession, setForceNewSession] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    destructive?: boolean
    confirmLabel?: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const [carryForwardSummary, setCarryForwardSummary] = useState<{
    mode: 'activated' | 'closed'
    closedTermName: string | null
    invoicesUpdated: number
    invoicesNeedingResend: number
    studentsWithCarryForward: number
    totalCarryForward: number
  } | null>(null)

  const [closePreview, setClosePreview] = useState<{
    cycle: CycleRow
    hasOutstanding: boolean
    studentsWithOutstandingCount: number
    totalOutstanding: number
    futureInvoicesToUpdateCount: number
    futureInvoicesNeedingResendCount: number
  } | null>(null)
  const [closePreviewLoadingId, setClosePreviewLoadingId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  const activeCycle = cycles.find(c => c.status === 'active')
  const draftCycle = cycles.find(c => c.status === 'draft')

  const cycleParam = searchParams.get('cycle')
  const selectedCycle = cycles.find(c => c.id === cycleParam) || activeCycle || draftCycle || cycles[0] || null

  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    const anchor = activeCycle || selectedCycle
    if (anchor?.sessionId) initial.add(anchor.sessionId)
    return initial
  })

  function toggleSession(sessionId: string) {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const cyclesBySession = useMemo(() => {
    const grouped: Record<string, { sessionName: string, sessionId: string | null, cycles: CycleRow[] }> = {}
    const ungrouped: CycleRow[] = []

    cycles.forEach(c => {
      if (c.sessionName && c.sessionId) {
        const key = c.sessionId
        if (!grouped[key]) {
          grouped[key] = { sessionName: c.sessionName, sessionId: c.sessionId, cycles: [] }
        }
        grouped[key].cycles.push(c)
      } else {
        ungrouped.push(c)
      }
    })

    const sortedGroups = Object.values(grouped).sort((a, b) => {
      const aLatest = Math.max(...a.cycles.map(c => new Date(c.startDate).getTime()))
      const bLatest = Math.max(...b.cycles.map(c => new Date(c.startDate).getTime()))
      return bLatest - aLatest
    })

    return { sortedGroups, ungrouped }
  }, [cycles])

  // Terms belonging to the same session as the selected term, in chronological order — feeds the timeline stepper.
  const timelineTerms = useMemo(() => {
    if (!selectedCycle?.sessionId) return []
    return cycles
      .filter(c => c.sessionId === selectedCycle.sessionId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
  }, [cycles, selectedCycle])

  // All terms closed everywhere → nudge the school to start a new session.
  const allTermsClosed = cycles.length > 0 && !activeCycle && !draftCycle
  const lastClosedCycle = useMemo(() => {
    if (!allTermsClosed) return null
    return [...cycles]
      .filter(c => c.status === 'closed')
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0] || null
  }, [cycles, allTermsClosed])

  function openCreate() {
    setEditingCycle(null)
    setForceNewSession(false)
    setPanelMode('create')
  }

  function openCreateNewSession() {
    setEditingCycle(null)
    setForceNewSession(true)
    setPanelMode('create')
  }

  function openEdit(cycle: CycleRow) {
    setEditingCycle(cycle)
    setForceNewSession(false)
    setPanelMode('edit')
  }

  function closePanel() {
    setPanelMode(null)
    setEditingCycle(null)
    setForceNewSession(false)
  }

  function handleActivate(cycle: CycleRow) {
    setError(null)
    const currentlyActive = cycles.find(c => c.status === 'active')
    let message = `Make "${cycle.name}" the active term.`
    if (currentlyActive && currentlyActive.id !== cycle.id) {
      message += ` "${currentlyActive.name}" will be closed. If any students have outstanding balances, their invoices in "${cycle.name}" (if generated) will be automatically updated to include the carry-forward.`
    }
    setConfirmDialog({
      title: 'Activate this term?',
      message,
      confirmLabel: 'Activate',
      onConfirm: async () => {
        const result = await activateTerm(cycle.id)
        if (result.error) {
          setError(result.error)
        } else if (result.summary && result.summary.closedTermName) {
          setCarryForwardSummary({ mode: 'activated', ...result.summary })
          router.refresh()
        } else {
          router.refresh()
        }
        setConfirmDialog(null)
      },
    })
  }

  async function handleClose(cycle: CycleRow) {
    setError(null)
    setClosePreviewLoadingId(cycle.id)
    const preview = await previewCloseTerm(cycle.id)
    setClosePreviewLoadingId(null)
    if ('error' in preview) {
      setError(preview.error)
      return
    }
    setClosePreview({ cycle, ...preview })
  }

  async function handleConfirmClose() {
    if (!closePreview) return
    setClosing(true)
    const result = await closeTerm(closePreview.cycle.id)
    setClosing(false)
    setClosePreview(null)

    if ('error' in result) {
      setError(result.error)
      return
    }

    if (result.summary.invoicesUpdated > 0) {
      setCarryForwardSummary({
        mode: 'closed',
        closedTermName: closePreview.cycle.name,
        invoicesUpdated: result.summary.invoicesUpdated,
        invoicesNeedingResend: result.summary.invoicesNeedingResend,
        studentsWithCarryForward: result.summary.studentsWithOutstanding,
        totalCarryForward: result.summary.totalOutstanding,
      })
    }
    router.refresh()
  }

  function handleReopenAsDraft(cycle: CycleRow) {
    setError(null)
    setConfirmDialog({
      title: `Move "${cycle.name}" back to draft?`,
      message: 'The term will be marked as draft, no longer active or closed. Use this if you activated by mistake.',
      confirmLabel: 'Move to draft',
      onConfirm: async () => {
        const result = await reopenTermAsDraft(cycle.id)
        if (result.error) setError(result.error)
        else router.refresh()
        setConfirmDialog(null)
      },
    })
  }

  function handleDeleteDraft(cycle: CycleRow) {
    setError(null)
    setConfirmDialog({
      title: `Delete draft "${cycle.name}"?`,
      message: 'This will permanently remove the term and all its fee items. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        const result = await deleteTermDraft(cycle.id)
        if (result.error) setError(result.error)
        else router.refresh()
        setConfirmDialog(null)
      },
    })
  }

  const sidePanelOpen = panelMode !== null

  const collectedPct = selectedCycle && selectedCycle.totalExpected > 0
    ? Math.round((selectedCycle.totalCollected / selectedCycle.totalExpected) * 100)
    : 0
  const outstandingAmount = selectedCycle ? selectedCycle.totalExpected - selectedCycle.totalCollected : 0
  const invoicedPct = selectedCycle && selectedCycle.totalActiveStudents > 0
    ? Math.round((selectedCycle.invoiceCount / selectedCycle.totalActiveStudents) * 100)
    : 0

  let daysUntilDue: number | null = null
  if (selectedCycle?.dueDate) {
    const due = new Date(selectedCycle.dueDate)
    const today = new Date()
    due.setHours(0, 0, 0, 0)
    today.setHours(0, 0, 0, 0)
    daysUntilDue = Math.round((due.getTime() - today.getTime()) / 86400000)
  }

  return (
    <>
      <header className="mb-6 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy">Billing cycles</h1>
          <p className="text-gray-500 mt-2 text-sm">Manage terms and sessions</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {cycles.length > 0 && (
            <TermSelector cycles={cycles} currentCycleId={selectedCycle?.id || null} paramName="cycle" />
          )}
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 whitespace-nowrap"
          >
            + New term
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {allTermsClosed && lastClosedCycle && (
        <div className="mb-6 p-4 bg-navy rounded-xl flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <p className="text-sm text-white">
              <strong>{lastClosedCycle.name}</strong> is closed. You can now start a new session
              {lastClosedCycle.sessionName && <> for <strong>{suggestNextSessionName(lastClosedCycle.sessionName)}</strong></>}.
            </p>
          </div>
          <button
            onClick={openCreateNewSession}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 whitespace-nowrap"
          >
            Start new session ✨
          </button>
        </div>
      )}

      <div className={`grid gap-4 ${sidePanelOpen ? 'grid-cols-[1fr_380px]' : 'grid-cols-1'}`}>

        <div className="min-w-0">

          {selectedCycle && (
            <>
              {/* KPI tiles for the selected term */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-white p-5 rounded-xl border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Invoices generated</p>
                  <p className="text-2xl font-bold text-navy">
                    {selectedCycle.invoiceCount} <span className="text-sm text-gray-400 font-medium">/ {selectedCycle.totalActiveStudents}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{invoicedPct}% of students</p>
                </div>
                <div className="bg-white p-5 rounded-xl border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Collected</p>
                  <p className="text-2xl font-bold text-mint">{formatNaira(selectedCycle.totalCollected)}</p>
                  <p className="text-xs text-gray-500 mt-1">{collectedPct}% of expected</p>
                </div>
                <div className="bg-white p-5 rounded-xl border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Outstanding</p>
                  <p className="text-2xl font-bold text-amber-600">{formatNaira(outstandingAmount)}</p>
                  <p className="text-xs text-gray-500 mt-1">{100 - collectedPct}% remaining</p>
                </div>
                <div className="bg-white p-5 rounded-xl border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Days until due</p>
                  {daysUntilDue === null ? (
                    <p className="text-2xl font-bold text-navy">—</p>
                  ) : (
                    <p className={`text-2xl font-bold ${daysUntilDue < 0 ? 'text-red-600' : 'text-navy'}`}>
                      {daysUntilDue < 0 ? `${Math.abs(daysUntilDue)}d overdue` : daysUntilDue}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    {selectedCycle.dueDate ? `Due ${formatDate(selectedCycle.dueDate)} · ${selectedCycle.name}` : 'No due date set'}
                  </p>
                </div>
              </div>

              {/* Current session timeline */}
              {timelineTerms.length > 0 && (
                <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-navy font-semibold text-sm">
                      {selectedCycle.sessionName} timeline
                    </h2>
                    <Link
                      href={`/fees/cycles/${selectedCycle.id}`}
                      className="text-xs text-mint font-medium hover:underline"
                    >
                      View term overview →
                    </Link>
                  </div>
                  <div className="flex items-start overflow-x-auto pb-1">
                    {timelineTerms.map((term, idx) => {
                      const badge = statusBadge(term.status)
                      const isLast = idx === timelineTerms.length - 1
                      return (
                        <Fragment key={term.id}>
                          <button
                            onClick={() => router.push(`/fees/cycles/${term.id}`)}
                            className="flex flex-col items-center text-center w-32 flex-shrink-0 group"
                          >
                            {term.status === 'closed' ? (
                              <span className="w-7 h-7 rounded-full bg-mint flex items-center justify-center flex-shrink-0">
                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            ) : term.status === 'active' ? (
                              <span className="w-7 h-7 rounded-full bg-mint-light border-2 border-mint flex items-center justify-center flex-shrink-0">
                                <span className="w-2.5 h-2.5 rounded-full bg-mint" />
                              </span>
                            ) : (
                              <span className="w-7 h-7 rounded-full border-2 border-gray-300 bg-white flex-shrink-0" />
                            )}
                            <p className="text-xs font-semibold text-navy mt-2 truncate w-full group-hover:text-mint transition-colors">{term.name}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(term.startDate)}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full mt-1 ${badge.cls}`}>{term.status}</span>
                          </button>
                          {!isLast && (
                            <div className="flex-1 min-w-[24px] h-7 flex items-center">
                              <div className="w-full border-t-2 border-dotted border-gray-300" />
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {cyclesBySession.sortedGroups.length === 0 && cyclesBySession.ungrouped.length === 0 && (
            <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
              <p className="text-gray-500 mb-3">No terms yet.</p>
              <button
                onClick={openCreate}
                className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
              >
                + Create first term
              </button>
            </div>
          )}

          {(cyclesBySession.sortedGroups.length > 0 || cyclesBySession.ungrouped.length > 0) && (
            <div>
              <h2 className="text-navy font-semibold text-sm mb-3">All terms</h2>
              <div className="space-y-3">
                {cyclesBySession.sortedGroups.map(group => (
                  <SessionAccordion
                    key={group.sessionId}
                    sessionName={group.sessionName}
                    sessionId={group.sessionId!}
                    cycles={group.cycles}
                    expanded={expandedSessions.has(group.sessionId!)}
                    onToggle={() => toggleSession(group.sessionId!)}
                    onEdit={openEdit}
                    onActivate={handleActivate}
                    onDeleteDraft={handleDeleteDraft}
                    onClose={handleClose}
                    onReopenAsDraft={handleReopenAsDraft}
                    closePreviewLoadingId={closePreviewLoadingId}
                  />
                ))}

                {cyclesBySession.ungrouped.length > 0 && (
                  <SessionAccordion
                    sessionName="No session"
                    sessionId="__none__"
                    cycles={cyclesBySession.ungrouped}
                    expanded={expandedSessions.has('__none__')}
                    onToggle={() => toggleSession('__none__')}
                    onEdit={openEdit}
                    onActivate={handleActivate}
                    onDeleteDraft={handleDeleteDraft}
                    onClose={handleClose}
                    onReopenAsDraft={handleReopenAsDraft}
                    closePreviewLoadingId={closePreviewLoadingId}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {panelMode && (
          <CreateTermPanel
            mode={panelMode}
            cycles={cycles}
            sessions={sessions}
            editingCycle={editingCycle || undefined}
            forceNewSession={forceNewSession}
            onClose={closePanel}
            onSuccess={(summary) => {
              closePanel()
              if (summary && summary.closedTermName) {
                setCarryForwardSummary({ mode: 'activated', ...summary })
              }
              router.refresh()
            }}
          />
        )}
      </div>

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
      {/* Close-term confirmation, with outstanding-balance preview */}
      {closePreview && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-base font-semibold text-navy mb-2">
                Close &quot;{closePreview.cycle.name}&quot;?
              </h3>

              {!closePreview.hasOutstanding ? (
                <p className="text-sm text-gray-600">
                  The term will be marked as closed. You can reopen it later if needed (as long as no invoices have been sent).
                </p>
              ) : (
                <>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Students with outstanding balance</span>
                      <span className="font-semibold text-navy">{closePreview.studentsWithOutstandingCount}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total outstanding</span>
                      <span className="font-semibold text-navy">
                        ₦{closePreview.totalOutstanding.toLocaleString('en-NG')}
                      </span>
                    </div>
                  </div>

                  {closePreview.futureInvoicesToUpdateCount > 0 ? (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                      <strong>{closePreview.futureInvoicesToUpdateCount}</strong> {closePreview.futureInvoicesToUpdateCount === 1 ? 'invoice' : 'invoices'} in other terms will be updated to include this carry-forward.
                      {closePreview.futureInvoicesNeedingResendCount > 0 && (
                        <> <strong>{closePreview.futureInvoicesNeedingResendCount}</strong> of these {closePreview.futureInvoicesNeedingResendCount === 1 ? 'was' : 'were'} already sent to parents and will need resending.</>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">
                      These balances will be added automatically once invoices are generated for these students in a future term.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setClosePreview(null)}
                disabled={closing}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClose}
                disabled={closing}
                className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50"
              >
                {closing ? 'Closing...' : 'Close term'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-close / post-activate carry-forward summary */}
      {carryForwardSummary && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-mint-light flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-navy">
                    {carryForwardSummary.mode === 'activated' ? 'Term activated' : 'Term closed'}
                  </h3>
                  {carryForwardSummary.mode === 'activated' && (
                    <p className="text-sm text-gray-600 mt-0.5">
                      {carryForwardSummary.closedTermName} has been closed.
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Students with outstanding balance</span>
                  <span className="font-semibold text-navy">{carryForwardSummary.studentsWithCarryForward}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Total carry-forward</span>
                  <span className="font-semibold text-navy">
                    ₦{carryForwardSummary.totalCarryForward.toLocaleString('en-NG')}
                  </span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                  <span className="text-gray-600">Invoices auto-updated</span>
                  <span className="font-semibold text-mint">{carryForwardSummary.invoicesUpdated}</span>
                </div>
              </div>

              {carryForwardSummary.invoicesNeedingResend > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 mb-4">
                  ⚠️ <strong>{carryForwardSummary.invoicesNeedingResend}</strong> of these invoices were already sent to parents. They now need resending with the updated totals.
                </div>
              )}

              {carryForwardSummary.studentsWithCarryForward > carryForwardSummary.invoicesUpdated && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 mb-4">
                  Note: {carryForwardSummary.studentsWithCarryForward - carryForwardSummary.invoicesUpdated} students didn&apos;t have an invoice yet in a future term. When one is generated for them, the carry-forward will be included automatically.
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex items-center justify-end">
              <button
                onClick={() => setCarryForwardSummary(null)}
                className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

interface AccordionProps {
  sessionName: string
  sessionId: string
  cycles: CycleRow[]
  expanded: boolean
  onToggle: () => void
  onEdit: (c: CycleRow) => void
  onActivate: (c: CycleRow) => void
  onDeleteDraft: (c: CycleRow) => void
  onClose: (c: CycleRow) => void
  onReopenAsDraft: (c: CycleRow) => void
  closePreviewLoadingId: string | null
}

function SessionAccordion({
  sessionName, cycles, expanded, onToggle, onEdit, onActivate, onDeleteDraft, onClose, onReopenAsDraft, closePreviewLoadingId,
}: AccordionProps) {
  const router = useRouter()
  const sorted = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const hasActive = cycles.some(c => c.status === 'active')

  function goToTerm(cycleId: string) {
    router.push(`/fees/cycles/${cycleId}`)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/60"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-navy font-semibold text-sm">{sessionName}</h3>
          {hasActive && <span className="w-1.5 h-1.5 rounded-full bg-mint" />}
          <span className="text-xs text-gray-400">{cycles.length} {cycles.length === 1 ? 'term' : 'terms'}</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Term</th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Dates</th>
                <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Status</th>
                <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Invoices</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Collected</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map(cycle => {
                const badge = statusBadge(cycle.status)
                return (
                  <tr
                    key={cycle.id}
                    onClick={() => goToTerm(cycle.id)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`}></span>
                        <span className="text-sm font-medium text-navy">{cycle.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-600">
                      {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
                      {cycle.dueDate && (
                        <div className="text-gray-400 mt-0.5">Due: {formatDate(cycle.dueDate)}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${badge.cls}`}>
                        {cycle.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center text-xs text-gray-700">
                      {cycle.invoiceCount} / {cycle.totalActiveStudents}
                    </td>
                    <td className="py-3 px-4 text-right text-xs text-gray-700">
                      {formatNaira(cycle.totalCollected)}
                      {cycle.totalExpected > 0 && (
                        <div className="text-gray-400 mt-0.5">of {formatNaira(cycle.totalExpected)}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-2">
                        {cycle.status === 'draft' && (
                          <>
                            <button
                              onClick={() => onActivate(cycle)}
                              className="text-xs text-mint font-medium hover:underline"
                            >
                              Activate
                            </button>
                            <span className="text-gray-300">·</span>
                            <button
                              onClick={() => onClose(cycle)}
                              disabled={closePreviewLoadingId === cycle.id}
                              className="text-xs text-amber-600 font-medium hover:underline disabled:opacity-50"
                            >
                              {closePreviewLoadingId === cycle.id ? 'Checking...' : 'Close'}
                            </button>
                            <span className="text-gray-300">·</span>
                          </>
                        )}
                        {cycle.status === 'active' && (
                          <>
                            <button
                              onClick={() => onClose(cycle)}
                              disabled={closePreviewLoadingId === cycle.id}
                              className="text-xs text-amber-600 font-medium hover:underline disabled:opacity-50"
                            >
                              {closePreviewLoadingId === cycle.id ? 'Checking...' : 'Close'}
                            </button>
                            <span className="text-gray-300">·</span>
                            <button
                              onClick={() => onReopenAsDraft(cycle)}
                              className="text-xs text-gray-600 font-medium hover:underline"
                            >
                              Back to draft
                            </button>
                            <span className="text-gray-300">·</span>
                          </>
                        )}
                        {cycle.status !== 'closed' && (
                          <button
                            onClick={() => onEdit(cycle)}
                            className="text-xs text-gray-600 font-medium hover:underline"
                          >
                            Edit
                          </button>
                        )}
                        {cycle.status === 'closed' && (
                          <span className="text-xs text-gray-400">Read-only</span>
                        )}
                        {cycle.status === 'draft' && cycle.invoiceCount === 0 && (
                          <>
                            <span className="text-gray-300">·</span>
                            <button
                              onClick={() => onDeleteDraft(cycle)}
                              className="text-xs text-red-600 font-medium hover:underline"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
