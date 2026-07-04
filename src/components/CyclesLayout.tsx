'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CycleRow, SessionRow } from '@/lib/queries/fees'
import CreateTermPanel from './CreateTermPanel'
import ConfirmDialog from './ConfirmDialog'
import { activateTerm, deleteTermDraft, closeTerm, reopenTermAsDraft } from '@/app/(app)/fees/cycles/actions'

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

export default function CyclesLayout({ cycles, sessions }: Props) {
  const router = useRouter()
  const [panelMode, setPanelMode] = useState<'create' | 'edit' | null>(null)
  const [editingCycle, setEditingCycle] = useState<CycleRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    destructive?: boolean
    confirmLabel?: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const [activationSummary, setActivationSummary] = useState<{
    closedTermName: string | null
    invoicesUpdated: number
    invoicesNeedingResend: number
    studentsWithCarryForward: number
    totalCarryForward: number
  } | null>(null)

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

  const activeCycle = cycles.find(c => c.status === 'active')

  function openCreate() {
    setEditingCycle(null)
    setPanelMode('create')
  }

  function openEdit(cycle: CycleRow) {
    setEditingCycle(cycle)
    setPanelMode('edit')
  }

  function closePanel() {
    setPanelMode(null)
    setEditingCycle(null)
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
          // Show detailed summary
          setActivationSummary(result.summary)
          router.refresh()
        } else {
          router.refresh()
        }
        setConfirmDialog(null)
      },
    })
  }

  function handleClose(cycle: CycleRow) {
    setError(null)
    setConfirmDialog({
      title: `Close "${cycle.name}"?`,
      message: 'The term will be marked as closed. You can reopen it later if needed (as long as no invoices have been sent).',
      confirmLabel: 'Close term',
      onConfirm: async () => {
        const result = await closeTerm(cycle.id)
        if (result.error) setError(result.error)
        else router.refresh()
        setConfirmDialog(null)
      },
    })
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

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy">Billing cycles</h1>
          <p className="text-gray-500 mt-2 text-sm">Manage terms and sessions</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
        >
          + New term
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className={`grid gap-4 ${sidePanelOpen ? 'grid-cols-[1fr_380px]' : 'grid-cols-1'}`}>

        <div>

          {activeCycle && (
            <Link
              href={`/fees/cycles/${activeCycle.id}`}
              className="block bg-white p-6 rounded-xl border border-gray-200 mb-6 hover:border-mint hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Current active term</p>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-mint"></span>
                    <h2 className="text-navy font-semibold text-xl">{activeCycle.name}</h2>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {formatDate(activeCycle.startDate)} – {formatDate(activeCycle.endDate)}
                    {activeCycle.dueDate && <> <span className="text-gray-400 font-bold">·</span> Due: {formatDate(activeCycle.dueDate)}</>}
                  </p>
                </div>
                <span className="text-xs text-mint font-medium">View overview →</span>
              </div>

              <div className="grid grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Invoices</p>
                  <p className="text-lg font-semibold text-navy">
                    {activeCycle.invoiceCount} <span className="text-sm text-gray-400">/ {activeCycle.totalActiveStudents}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Expected</p>
                  <p className="text-lg font-semibold text-navy">{formatNaira(activeCycle.totalExpected)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Collected</p>
                  <p className="text-lg font-semibold text-mint">{formatNaira(activeCycle.totalCollected)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Outstanding</p>
                  <p className="text-lg font-semibold text-amber-600">
                    {formatNaira(activeCycle.totalExpected - activeCycle.totalCollected)}
                  </p>
                </div>
              </div>
            </Link>
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

          {cyclesBySession.sortedGroups.map(group => (
            <SessionGroup
              key={group.sessionId}
              sessionName={group.sessionName}
              cycles={group.cycles}
              onEdit={openEdit}
              onActivate={handleActivate}
              onDeleteDraft={handleDeleteDraft}
              onClose={handleClose}
              onReopenAsDraft={handleReopenAsDraft}
            />
          ))}

          {cyclesBySession.ungrouped.length > 0 && (
            <SessionGroup
              sessionName="No session"
              cycles={cyclesBySession.ungrouped}
              onEdit={openEdit}
              onActivate={handleActivate}
              onDeleteDraft={handleDeleteDraft}
              onClose={handleClose}
              onReopenAsDraft={handleReopenAsDraft}
            />
          )}
        </div>

        {panelMode && (
          <CreateTermPanel
            mode={panelMode}
            cycles={cycles}
            sessions={sessions}
            editingCycle={editingCycle || undefined}
            onClose={closePanel}
            onSuccess={() => {
              closePanel()
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
      {activationSummary && activationSummary.closedTermName && (
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
            <h3 className="text-base font-semibold text-navy">Term activated</h3>
            <p className="text-sm text-gray-600 mt-0.5">
              {activationSummary.closedTermName} has been closed.
            </p>
          </div>
        </div>

        {activationSummary.studentsWithCarryForward > 0 ? (
          <>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Students with outstanding balance</span>
                <span className="font-semibold text-navy">{activationSummary.studentsWithCarryForward}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total carry-forward</span>
                <span className="font-semibold text-navy">
                  ₦{activationSummary.totalCarryForward.toLocaleString('en-NG')}
                </span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                <span className="text-gray-600">Invoices auto-updated</span>
                <span className="font-semibold text-mint">{activationSummary.invoicesUpdated}</span>
              </div>
            </div>

            {activationSummary.invoicesNeedingResend > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 mb-4">
                ⚠️ <strong>{activationSummary.invoicesNeedingResend}</strong> of these invoices were already sent to parents. They now need resending with the updated totals.
              </div>
            )}

            {activationSummary.studentsWithCarryForward > activationSummary.invoicesUpdated && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 mb-4">
                Note: {activationSummary.studentsWithCarryForward - activationSummary.invoicesUpdated} students didn&apos;t have an invoice yet for the new term. When you generate their invoices, the carry-forward will be included automatically.
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600 mb-4">
            All students in the closed term paid in full. No carry-forward needed.
          </p>
        )}
      </div>

      <div className="p-4 border-t border-gray-100 flex items-center justify-end">
        <button
          onClick={() => setActivationSummary(null)}
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

interface GroupProps {
  sessionName: string
  cycles: CycleRow[]
  onEdit: (c: CycleRow) => void
  onActivate: (c: CycleRow) => void
  onDeleteDraft: (c: CycleRow) => void
  onClose: (c: CycleRow) => void
  onReopenAsDraft: (c: CycleRow) => void
}

function SessionGroup({ sessionName, cycles, onEdit, onActivate, onDeleteDraft, onClose, onReopenAsDraft }: GroupProps) {
  const router = useRouter()
  const sorted = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate))

  function goToTerm(cycleId: string) {
  router.push(`/fees/cycles/${cycleId}`)
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-navy font-semibold">{sessionName}</h3>
        <p className="text-xs text-gray-500">{cycles.length} {cycles.length === 1 ? 'term' : 'terms'}</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
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
                        </>
                      )}
                      {cycle.status === 'active' && (
                        <>
                          <button
                            onClick={() => onClose(cycle)}
                            className="text-xs text-amber-600 font-medium hover:underline"
                          >
                            Close
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
    </div>
  )
}