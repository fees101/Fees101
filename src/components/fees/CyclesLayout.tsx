'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CycleRow, SessionRow } from '@/lib/queries/fees'
import CreateTermPanel from './CreateTermPanel'
import CarryForwardSummaryModal from './CarryForwardSummaryModal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import { activateTerm, deleteTermDraft, reopenTermAsDraft } from '@/app/(app)/fees/cycles/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'
import { useActiveJobs } from '@/lib/jobs/ActiveJobsProvider'
import BulkSendInvoicesPanel from '@/components/invoices/BulkSendInvoicesPanel'
import GenerateInvoicesPanel from './GenerateInvoicesPanel'
import { formatDate } from '@/lib/format/date'
import Toast from '@/components/ui/Toast'

interface Props {
  cycles: CycleRow[]
  sessions: SessionRow[]
  showFinancials?: boolean
}

// Paper-ground palette — colour carries state, never decoration. Green only
// where money arrived; ochre for a state awaiting a human; signal red marks
// the active term and the "in progress" collection figure.
const INK = '#201e1d'
const META = '#605d5d'
const BODY = '#444141'
const DIM = '#9b9797'
const RULE_SOFT = '#d7d3d3'
const LEDGER = '#0a6b3d'
const OCHRE = '#8a4805'
const SIGNAL = '#ec3013'

// Terms table columns, shared by header + session sub-rows + term rows so they
// line up. Inline (not a Tailwind class) because the WASM build doesn't emit
// arbitrary multi-minmax grid templates.
const CYCLE_GRID = 'minmax(120px,1.4fr) minmax(90px,1fr) minmax(90px,1fr) minmax(76px,0.8fr) minmax(70px,0.7fr)'
const CYCLE_MIN = 540

function formatNaira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

function stateText(status: 'draft' | 'active' | 'closed'): { label: string, ink: string } {
  if (status === 'active') return { label: 'ACTIVE', ink: INK }
  if (status === 'draft') return { label: 'DRAFT', ink: OCHRE }
  return { label: 'CLOSED', ink: META }
}

// A lighter step row than the active-term lifecycle (no progress bar) — used
// for the draft "prepare" surface and the closed "what this term did" recap so
// the inline panel below the list reads as each term's own stepped workspace,
// changing with its status.
interface StepLite {
  n: string
  title: string
  body: string
  numInk: string
  stateLabel: string
  stateInk: string
  action: { label: string; onClick: () => void; primary?: boolean } | null
}

function renderStepLite(s: StepLite) {
  return (
    <div
      key={s.n}
      className="grid items-start"
      style={{ gridTemplateColumns: '34px minmax(0,1fr) auto', gap: 16, padding: '16px 0', borderBottom: `1px solid ${RULE_SOFT}` }}
    >
      <span className="m-num text-[13px] font-extrabold" style={{ color: s.numInk, paddingTop: 2 }}>{s.n}</span>
      <div style={{ minWidth: 0 }}>
        <p className="text-[16px] font-bold" style={{ color: INK, margin: '0 0 3px' }}>{s.title}</p>
        <p className="text-[13px] m-num" style={{ color: BODY, margin: 0, lineHeight: 1.5 }}>{s.body}</p>
      </div>
      <div className="text-right">
        <p className="text-[12px] font-semibold tracking-[0.08em]" style={{ color: s.stateInk, margin: '0 0 8px' }}>{s.stateLabel}</p>
        {s.action && (
          <button
            onClick={s.action.onClick}
            className={`m-btn m-btn-sm uppercase tracking-[0.04em] ${s.action.primary ? 'm-btn-primary' : 'm-btn-outline'}`}
          >
            {s.action.label}
          </button>
        )}
      </div>
    </div>
  )
}

// A term's numbered lifecycle row (progress bar + right-aligned state/action) —
// shared by the active term's 01-04 sequence and the closed term's read-only
// recap, matching the App Shell canvas's cycleSteps template exactly: a
// secondary action is a real bordered button (its .bo class, m-btn-outline
// here), not a borderless text link — that borderless convention belongs to
// generic table rows (.txt), a different template.
interface Step {
  n: string
  title: string
  body: string
  hasBar: boolean
  pct: number
  numInk: string
  titleInk: string
  stateLabel: string
  stateInk: string
  // Progress-bar fill. Defaults to ink — only a step tracking money actually
  // collected sets this to LEDGER; generation/send progress is work done, not
  // money, so it must not fill green regardless of how complete it is.
  barInk?: string
  action: { label: string; onClick: () => void; variant: 'primary' | 'outline'; disabled?: boolean } | null
}

function renderStep(s: Step) {
  return (
    <div
      key={s.n}
      className="grid items-start"
      style={{ gridTemplateColumns: '34px minmax(0,1fr) auto', gap: 16, padding: '16px 0', borderBottom: `1px solid ${RULE_SOFT}` }}
    >
      <span className="m-num text-[13px] font-extrabold" style={{ color: s.numInk, paddingTop: 2 }}>{s.n}</span>
      <div style={{ minWidth: 0 }}>
        <p className="text-[16px] font-bold" style={{ color: s.titleInk, margin: '0 0 3px' }}>{s.title}</p>
        <p className="text-[13px] m-num" style={{ color: BODY, margin: '0 0 8px', lineHeight: 1.5 }}>{s.body}</p>
        {s.hasBar && (
          <div style={{ height: 4, background: RULE_SOFT, maxWidth: 420 }}>
            <div style={{ height: 4, background: s.barInk || INK, width: `${Math.min(100, Math.max(0, s.pct))}%` }} />
          </div>
        )}
      </div>
      <div className="text-right">
        <p className="text-[12px] font-semibold tracking-[0.08em]" style={{ color: s.stateInk, margin: '0 0 8px' }}>{s.stateLabel}</p>
        {s.action && (
          <button
            onClick={s.action.onClick}
            disabled={s.action.disabled}
            className={`m-btn m-btn-sm uppercase tracking-[0.04em] ${s.action.variant === 'primary' ? 'm-btn-primary' : 'm-btn-outline'}`}
            style={s.action.disabled ? { opacity: 0.6, cursor: 'default' } : undefined}
          >
            {s.action.label}
          </button>
        )}
      </div>
    </div>
  )
}

function suggestNextSessionName(sessionName: string): string {  const match = sessionName.match(/(\d{4})\s*\/\s*(\d{4})/)
  if (match) return `${parseInt(match[1]) + 1}/${parseInt(match[2]) + 1}`
  return 'a new session'
}

export default function CyclesLayout({ cycles, sessions, showFinancials = true }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const canManageFeeStructure = useCan('manage-fee-structure')
  const canManageInvoices = useCan('manage-invoices')
  const canRunYearEnd = useCan('run-year-end')
  const { trackJob } = useActiveJobs()
  // Navigating to another route (e.g. "Review close") fetches that page's
  // server data before anything changes on screen — with no pending state
  // the button looked unresponsive for the several seconds that takes.
  const [isNavPending, startNav] = useTransition()

  // Carrying forward outstanding balances into future-term invoices can be
  // handed off to a close_term background job (see closeTermAndCarryForward)
  // when there's enough work to risk a timeout — track it so the floating
  // chip shows live progress and a toast fires on completion.
  function trackCloseTermJobIfAny(jobId: string | null | undefined, totalInvoices: number) {
    if (!jobId) return
    trackJob(jobId, 'close_term', 'Carrying forward balances', { total: totalInvoices }, undefined, { href: '/fees/cycles' })
  }

  const [panelMode, setPanelMode] = useState<'create' | 'edit' | null>(null)
  const [editingCycle, setEditingCycle] = useState<CycleRow | null>(null)
  const [forceNewSession, setForceNewSession] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    destructive?: boolean
    confirmLabel?: string
    onConfirm: () => Promise<void>
  } | null>(null)
  // Undo-activation and delete-draft both destroy real state (an activation,
  // or the term entirely) — they get the itemized DestructiveConfirmModal
  // rather than the plain ConfirmDialog above.
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

  // Opt-in fee adjustments that had no matching fee item in the new term, so
  // they couldn't be carried forward — the admin needs to know so a student's
  // discount/exemption isn't silently lost.
  const [unmatchedAdjustments, setUnmatchedAdjustments] = useState<
    { studentId: string; feeItemName: string }[]
  >([])

  // Send-to-parents from the active term's lifecycle step 02.
  const [lifecycleSendOpen, setLifecycleSendOpen] = useState(false)
  // Generate invoices for the selected term, in place from the list — the same
  // panel the overview page uses, so the everyday "generate" is one click here
  // rather than a drill-in. cycleId identifies which term it runs for.
  const [generateCycleId, setGenerateCycleId] = useState<string | null>(null)

  const activeCycle = cycles.find(c => c.status === 'active')
  const draftCycle = cycles.find(c => c.status === 'draft')

  const cycleParam = searchParams.get('cycle')
  // The lifecycle below tracks a selected term. Default to the active term (the
  // one with live progress), falling back to a draft, then the newest term.
  const [selectedId, setSelectedId] = useState<string | null>(
    (cycleParam && cycles.some(c => c.id === cycleParam))
      ? cycleParam
      : (activeCycle?.id || draftCycle?.id || cycles[0]?.id || null)
  )
  const selectedCycle = cycles.find(c => c.id === selectedId) || activeCycle || draftCycle || cycles[0] || null

  const cyclesBySession = useMemo(() => {
    const grouped: Record<string, { sessionName: string, sessionId: string | null, cycles: CycleRow[] }> = {}
    const ungrouped: CycleRow[] = []
    cycles.forEach(c => {
      if (c.sessionName && c.sessionId) {
        const key = c.sessionId
        if (!grouped[key]) grouped[key] = { sessionName: c.sessionName, sessionId: c.sessionId, cycles: [] }
        grouped[key].cycles.push(c)
      } else {
        ungrouped.push(c)
      }
    })
    const sortedGroups = Object.values(grouped)
      .map(g => ({ ...g, cycles: [...g.cycles].sort((a, b) => b.startDate.localeCompare(a.startDate)) }))
      .sort((a, b) => {
        const aLatest = Math.max(...a.cycles.map(c => new Date(c.startDate).getTime()))
        const bLatest = Math.max(...b.cycles.map(c => new Date(c.startDate).getTime()))
        return bLatest - aLatest
      })
    return { sortedGroups, ungrouped: [...ungrouped].sort((a, b) => b.startDate.localeCompare(a.startDate)) }
  }, [cycles])

  // All terms closed everywhere → nudge the school to start a new session.
  const allTermsClosed = cycles.length > 0 && !activeCycle && !draftCycle
  const lastClosedCycle = useMemo(() => {
    if (!allTermsClosed) return null
    return [...cycles].filter(c => c.status === 'closed').sort((a, b) => b.endDate.localeCompare(a.endDate))[0] || null
  }, [cycles, allTermsClosed])

  // Owner-approved nudge (2026-09-22): neither "New session" (Academic
  // structure) nor "Create term" here does any student promotion — only
  // Year-End Rollover does. Scoped to the currently ACTIVE session (not the
  // global allTermsClosed check above, which can differ, e.g. a draft term
  // prepped under a different session) so this only fires for "the active
  // session has nothing left to activate," never for a brand-new school that
  // has simply never activated a first term yet — hence also requiring at
  // least one closed cycle under that same session.
  const activeSessionRow = sessions.find(s => s.status === 'active') || null
  const activeSessionWrappedUp = useMemo(() => {
    if (!activeSessionRow) return false
    const sessionCycles = cycles.filter(c => c.sessionId === activeSessionRow.id)
    const hasNonClosed = sessionCycles.some(c => c.status !== 'closed')
    const hasClosed = sessionCycles.some(c => c.status === 'closed')
    return !hasNonClosed && hasClosed
  }, [cycles, activeSessionRow])

  function openCreate() { setEditingCycle(null); setForceNewSession(false); setPanelMode('create') }
  function openCreateNewSession() { setEditingCycle(null); setForceNewSession(true); setPanelMode('create') }
  function openEdit(cycle: CycleRow) { setEditingCycle(cycle); setForceNewSession(false); setPanelMode('edit') }
  function closePanel() { setPanelMode(null); setEditingCycle(null); setForceNewSession(false) }

  function handleActivate(cycle: CycleRow) {
    setError(null)
    // A draft term whose session predates the current active session belongs to
    // a past academic year — the server rejects activating it. Catch it here so
    // the admin gets a clear message instead of confirming, then hitting a wall.
    const activeSession = sessions.find(s => s.status === 'active')
    const cycleSession = cycle.sessionId ? sessions.find(s => s.id === cycle.sessionId) : undefined
    if (
      activeSession && cycleSession && cycleSession.id !== activeSession.id &&
      cycleSession.startDate < activeSession.startDate
    ) {
      setError(`"${cycle.name}" belongs to "${cycleSession.name}", a past academic year. Terms from past years can't be activated.`)
      return
    }
    const currentlyActive = cycles.find(c => c.status === 'active')

    // Activating closes whatever term is currently live as a side effect
    // (activateTerm calls closeTermAndCarryForward internally). Rather than
    // doing that invisibly inside a confirm dialog, route through the real
    // Close term review flow first — the same page reached via "Review
    // close" elsewhere — so the admin sees and confirms the close on its own
    // terms, then lands back here to activate. ?activateAfter tells that page
    // to activate this draft once the close completes.
    if (currentlyActive && currentlyActive.id !== cycle.id) {
      router.push(`/fees/close-term?cycle=${currentlyActive.id}&activateAfter=${cycle.id}`)
      return
    }

    setConfirmDialog({
      title: 'Activate this term?',
      message: `Make "${cycle.name}" the active term.`,
      confirmLabel: 'Activate',
      onConfirm: async () => {
        const result = await activateTerm(cycle.id)
        if (result.error) {
          setError(result.error)
          setToast({ ok: false, message: result.error })
        } else if (result.summary && result.summary.closedTermName) {
          setCarryForwardSummary({ mode: 'activated', ...result.summary })
          trackCloseTermJobIfAny(result.summary.jobId, result.summary.invoicesUpdated)
          setSelectedId(cycle.id)
          setToast({ ok: true, message: `${cycle.name} activated.` })
          router.refresh()
        } else {
          setSelectedId(cycle.id)
          setToast({ ok: true, message: `${cycle.name} activated.` })
          router.refresh()
        }
        setConfirmDialog(null)
      },
    })
  }

  function handleReopenAsDraft(cycle: CycleRow) {
    setError(null)
    setDestructiveError(null)
    setDestructiveAction({ type: 'undo-activation', cycle })
  }

  function handleDeleteDraft(cycle: CycleRow) {
    setError(null)
    setDestructiveError(null)
    setDestructiveAction({ type: 'delete-draft', cycle })
  }

  async function handleDestructiveConfirm() {
    if (!destructiveAction) return
    const { type, cycle } = destructiveAction
    setDestructiveBusy(true)
    setDestructiveError(null)
    const result = type === 'undo-activation'
      ? await reopenTermAsDraft(cycle.id)
      : await deleteTermDraft(cycle.id)
    setDestructiveBusy(false)
    if (result.error) {
      setDestructiveError(result.error)
      return
    }
    setDestructiveAction(null)
    setToast({ ok: true, message: type === 'undo-activation' ? `${cycle.name} reopened as draft.` : `${cycle.name} deleted.` })
    router.refresh()
  }

  // Derived figures for the selected term's lifecycle.
  const collectedPct = selectedCycle && selectedCycle.totalExpected > 0
    ? Math.round((selectedCycle.totalCollected / selectedCycle.totalExpected) * 100)
    : 0
  // Cap the display the same way the list's RATE column does, so a carried-in
  // credit or an over-collection never renders as a runaway percentage.
  const collectedPctText = collectedPct > 999 ? '>999%' : `${collectedPct}%`
  // Active students without an invoice yet in the selected term — powers the
  // "Generate N missing" quick action and its label.
  const selectedMissing = selectedCycle
    ? Math.max(0, selectedCycle.totalActiveStudents - selectedCycle.invoiceCount)
    : 0
  let daysUntilDue: number | null = null
  if (selectedCycle?.dueDate) {
    const due = new Date(selectedCycle.dueDate)
    const today = new Date()
    due.setHours(0, 0, 0, 0)
    today.setHours(0, 0, 0, 0)
    daysUntilDue = Math.round((due.getTime() - today.getTime()) / 86400000)
  }

  const steps: Step[] = useMemo(() => {
    const c = selectedCycle
    if (!c || c.status !== 'active') return []
    const missing = Math.max(0, c.totalActiveStudents - c.invoiceCount)
    const genPct = c.totalActiveStudents > 0 ? Math.round((c.invoiceCount / c.totalActiveStudents) * 100) : 0
    const toSend = c.invoicesUnsent + c.invoicesNeedingResend
    const sentPct = c.invoiceCount > 0 ? Math.round((c.invoicesSent / c.invoiceCount) * 100) : 0
    const collectingBody = showFinancials
      ? `${formatNaira(c.totalCollected)} of ${formatNaira(c.totalExpected)} in.`
      : `${collectedPctText} of what's been billed is in.`
    return [
      {
        n: '01',
        title: 'Invoices generated',
        body: `${c.invoiceCount} of ${c.totalActiveStudents} students.` + (missing > 0
          ? ` ${missing} ${missing === 1 ? 'student has' : 'students have'} no invoice yet.`
          : ' Every active student has one.'),
        hasBar: true, pct: genPct,
        numInk: c.invoiceCount > 0 ? INK : DIM, titleInk: INK,
        stateLabel: missing > 0 ? `${missing} MISSING` : (c.invoiceCount > 0 ? 'DONE' : 'NONE'),
        stateInk: missing > 0 ? OCHRE : (c.invoiceCount > 0 ? INK : OCHRE),
        action: (missing > 0 && canManageInvoices)
          ? { label: `Generate ${missing} missing`, onClick: () => setGenerateCycleId(c.id), variant: 'outline' }
          : null,
      },
      {
        n: '02',
        title: 'Invoices sent to parents',
        body: `${c.invoicesSent} sent.` + (c.invoicesNeedingResend > 0
          ? ` ${c.invoicesNeedingResend} changed since sending and ${c.invoicesNeedingResend === 1 ? 'needs' : 'need'} resending.`
          : (c.invoicesUnsent > 0 ? ` ${c.invoicesUnsent} not yet sent.` : ' All caught up.')),
        hasBar: true, pct: sentPct,
        numInk: c.invoicesSent > 0 ? INK : DIM, titleInk: INK,
        stateLabel: toSend > 0 ? `${toSend} UNSENT` : (c.invoicesSent > 0 ? 'ALL SENT' : 'NONE'),
        stateInk: toSend > 0 ? OCHRE : (c.invoicesSent > 0 ? INK : OCHRE),
        action: (toSend > 0 && canManageInvoices)
          ? { label: `Send ${toSend}`, onClick: () => setLifecycleSendOpen(true), variant: 'primary' }
          : null,
      },
      {
        n: '03',
        title: 'Collecting',
        body: collectingBody + (daysUntilDue != null
          ? (daysUntilDue >= 0
            ? ` ${daysUntilDue} ${daysUntilDue === 1 ? 'day' : 'days'} until the term closes.`
            : ` ${Math.abs(daysUntilDue)} ${Math.abs(daysUntilDue) === 1 ? 'day' : 'days'} past the due date.`)
          : ''),
        hasBar: true, pct: collectedPct,
        numInk: SIGNAL, titleInk: INK,
        stateLabel: `${collectedPctText} · IN PROGRESS`, stateInk: INK,
        barInk: LEDGER,
        action: null,
      },
      {
        n: '04',
        title: 'Close the term',
        body: 'Carries every unpaid balance forward onto the next term and locks this one. You will see exactly which students and how much moves before anything happens, and it cannot be undone afterwards.',
        hasBar: false, pct: 0,
        numInk: DIM, titleInk: META,
        stateLabel: 'NOT YET', stateInk: META,
        action: canManageFeeStructure
          ? {
              label: isNavPending ? 'Opening…' : 'Review close',
              onClick: () => startNav(() => router.push(`/fees/close-term?cycle=${c.id}`)),
              variant: 'outline',
              disabled: isNavPending,
            }
          : null,
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycle, collectedPct, collectedPctText, daysUntilDue, showFinancials, canManageInvoices, canManageFeeStructure, isNavPending])

  // Draft readiness — the whole draft workspace keys off this: is the term
  // ready to go live, and if not, what's still to do. Prerequisites are real:
  // dates AND at least one fee item (drafting invoices is optional). A term
  // whose session is a past academic year can't be activated at all (the
  // server rejects it), so it's gated here too rather than letting the click
  // hit a wall.
  const draftReadiness = useMemo(() => {
    const c = selectedCycle
    if (!c || c.status !== 'draft') return null
    const hasDates = !!c.startDate && !!c.endDate
    const feeSet = c.feeItemCount > 0
    const drafted = c.invoiceCount > 0
    const activeSession = sessions.find(s => s.status === 'active')
    const cycleSession = c.sessionId ? sessions.find(s => s.id === c.sessionId) : undefined
    const isPastSession = !!(
      activeSession && cycleSession &&
      cycleSession.id !== activeSession.id &&
      cycleSession.startDate < activeSession.startDate
    )
    const todo: string[] = []
    if (!hasDates) todo.push('set the term dates')
    if (!feeSet) todo.push('add at least one fee')
    const ready = !isPastSession && todo.length === 0

    let headline: string
    let subtext: string
    let headlineInk: string
    if (isPastSession) {
      headline = "This term can't be activated"
      subtext = "It belongs to a past academic year. You can still edit its details, but a past-year term can't become the live term."
      headlineInk = META
    } else if (ready) {
      headline = 'Ready to activate'
      subtext = 'The dates and fees are set. Review what activating does below, then make it the live term. Nothing reaches parents until you do.'
      headlineInk = INK
    } else {
      headline = `Not ready to activate. ${todo.length} ${todo.length === 1 ? 'thing' : 'things'} to do first.`
      subtext = 'Finish the required steps below. Nothing is billed or sent to parents until this term is live.'
      headlineInk = OCHRE
    }
    return { hasDates, feeSet, drafted, isPastSession, todo, ready, headline, subtext, headlineInk }
  }, [selectedCycle, sessions])

  // What's still outstanding on the term that WOULD be closed if this draft is
  // activated — separate from draftReadiness, which is only about the draft's
  // own setup. A "READY" verdict on the draft says nothing about whether the
  // live term still has unsent/ungenerated invoices or unpaid balances, so
  // this feeds a short factual description instead of a pass/fail pill. None
  // of this blocks activation — closing carries these forward regardless.
  // Split from the payment fact (studentsWithOutstanding) since that already
  // gets its own dedicated sentence with a naira figure below.
  const activeInvoiceGaps: string[] = useMemo(() => {
    if (!activeCycle) return []
    const items: string[] = []
    const missing = Math.max(0, activeCycle.totalActiveStudents - activeCycle.invoiceCount)
    if (missing > 0) items.push(`${missing} ${missing === 1 ? 'invoice' : 'invoices'} not generated`)
    if (activeCycle.invoicesUnsent > 0) items.push(`${activeCycle.invoicesUnsent} unsent`)
    if (activeCycle.invoicesNeedingResend > 0) items.push(`${activeCycle.invoicesNeedingResend} changed since sending`)
    return items
  }, [activeCycle])

  const activeTermPending: string[] = useMemo(() => {
    if (!activeCycle) return []
    const items = [...activeInvoiceGaps]
    if (activeCycle.studentsWithOutstanding > 0) {
      items.push(`${activeCycle.studentsWithOutstanding} ${activeCycle.studentsWithOutstanding === 1 ? 'student' : 'students'} yet to pay`)
    }
    return items
  }, [activeCycle, activeInvoiceGaps])

  // Required-before-activating steps (dates, then fees). Colour carries state
  // and never marks a done setup step green — green is money-arrived only, so a
  // completed step reads ink and an outstanding required one reads ochre. An
  // outstanding required step is the emphasized (primary) next action.
  const draftSteps: StepLite[] = useMemo(() => {
    const c = selectedCycle
    if (!c || c.status !== 'draft') return []
    const hasDates = !!c.startDate && !!c.endDate
    const feeSet = c.feeItemCount > 0
    return [
      {
        n: '01',
        title: "Set the term's dates",
        body: hasDates
          ? `${formatDate(c.startDate)} to ${formatDate(c.endDate)}${c.dueDate ? `, payment due ${formatDate(c.dueDate)}` : ''}.`
          : 'Add a start, end and due date so invoices and reminders line up.',
        numInk: hasDates ? INK : OCHRE,
        stateLabel: hasDates ? 'SET' : 'REQUIRED',
        stateInk: hasDates ? META : OCHRE,
        action: canManageFeeStructure
          ? { label: hasDates ? 'Edit dates' : 'Set dates', onClick: () => openEdit(c), primary: !hasDates }
          : null,
      },
      {
        n: '02',
        title: "Set this term's fees",
        body: feeSet
          ? `${c.feeItemCount} fee ${c.feeItemCount === 1 ? 'item' : 'items'} set. Nothing can be billed until at least one exists.`
          : 'No fees yet. Add at least one so this term has something to bill.',
        numInk: feeSet ? INK : OCHRE,
        stateLabel: feeSet ? 'SET' : 'REQUIRED',
        stateInk: feeSet ? META : OCHRE,
        action: canManageFeeStructure
          ? { label: feeSet ? 'Edit fees' : 'Add fees', onClick: () => router.push(`/fees/structure?cycle=${c.id}&from=${encodeURIComponent(`/fees/cycles?cycle=${c.id}`)}`), primary: !feeSet }
          : null,
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycle, canManageFeeStructure])

  // Optional advance step — drafting invoices before go-live is never required,
  // so it stays visually light (dim number, outline action) and reads OPTIONAL.
  const draftOptional: StepLite | null = useMemo(() => {
    const c = selectedCycle
    if (!c || c.status !== 'draft') return null
    const drafted = c.invoiceCount > 0
    return {
      n: '03',
      title: 'Draft invoices in advance',
      body: drafted
        ? `${c.invoiceCount} invoice${c.invoiceCount === 1 ? '' : 's'} drafted. Nothing is sent while the term is a draft.`
        : "Optional. Generate them now so they're ready to print or send the moment you activate. Nothing goes to parents yet.",
      numInk: drafted ? INK : DIM,
      stateLabel: drafted ? `${c.invoiceCount} DRAFTED` : 'OPTIONAL',
      stateInk: drafted ? META : DIM,
      action: canManageInvoices
        ? { label: drafted ? 'Generate more' : 'Draft invoices', onClick: () => setGenerateCycleId(c.id) }
        : null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycle, canManageInvoices])

  // Closed-term recap — read-only, so every action is null, but the same
  // numbered-row shape as the active term's lifecycle keeps a closed term from
  // reading as an empty page. Outstanding balance only appears as a step when
  // there is one to report; a fully-collected term skips straight to nothing.
  const closedSteps: Step[] = useMemo(() => {
    const c = selectedCycle
    if (!c || c.status !== 'closed') return []
    const genPct = c.totalActiveStudents > 0 ? Math.round((c.invoiceCount / c.totalActiveStudents) * 100) : 0
    const sentPct = c.invoiceCount > 0 ? Math.round((c.invoicesSent / c.invoiceCount) * 100) : 0
    const finalPct = c.totalExpected > 0 ? Math.round((c.totalCollected / c.totalExpected) * 100) : 0
    const finalPctText = finalPct > 999 ? '>999%' : `${finalPct}%`
    const result: Step[] = [
      {
        n: '01',
        title: 'Invoices generated',
        body: `${c.invoiceCount} of ${c.totalActiveStudents} students billed.`,
        hasBar: true, pct: genPct,
        numInk: INK, titleInk: INK,
        stateLabel: 'DONE', stateInk: INK,
        action: null,
      },
      {
        n: '02',
        title: 'Invoices sent to parents',
        body: `${c.invoicesSent} of ${c.invoiceCount} sent.`,
        hasBar: true, pct: sentPct,
        numInk: INK, titleInk: INK,
        stateLabel: 'DONE', stateInk: INK,
        action: null,
      },
      {
        n: '03',
        title: 'Final collection',
        body: showFinancials
          ? `${formatNaira(c.totalCollected)} of ${formatNaira(c.totalExpected)} billed came in.`
          : `${finalPctText} of what was billed came in.`,
        hasBar: true, pct: finalPct,
        numInk: INK, titleInk: INK,
        stateLabel: `${finalPctText} FINAL`, stateInk: INK,
        barInk: LEDGER,
        action: null,
      },
    ]
    if (c.studentsWithOutstanding > 0) {
      result.push({
        n: '04',
        title: 'Outstanding balance',
        body: showFinancials
          ? `${formatNaira(c.totalOutstanding)} still owed by ${c.studentsWithOutstanding} ${c.studentsWithOutstanding === 1 ? 'student' : 'students'}. Payments can still be recorded against it.`
          : `${c.studentsWithOutstanding} ${c.studentsWithOutstanding === 1 ? 'student' : 'students'} still ${c.studentsWithOutstanding === 1 ? 'has' : 'have'} a balance. Payments can still be recorded against it.`,
        hasBar: false, pct: 0,
        numInk: OCHRE, titleInk: INK,
        stateLabel: 'OPEN', stateInk: OCHRE,
        action: null,
      })
    }
    return result
  }, [selectedCycle, showFinancials])

  const hasAnyTerms = cyclesBySession.sortedGroups.length > 0 || cyclesBySession.ungrouped.length > 0

  const renderTermRow = (c: CycleRow) => {
    const st = stateText(c.status)
    const isActive = c.status === 'active'
    const isSelected = c.id === selectedId
    const expected = c.totalExpected
    const collected = c.totalCollected
    const billedText = expected > 0 ? (showFinancials ? formatNaira(expected) : '—') : '—'
    const collectedText = collected > 0 ? (showFinancials ? formatNaira(collected) : '—') : '—'
    // Collected is bucketed by payment date across the whole school, so a term
    // that billed little but sat in a busy collection window can read well over
    // 100%. Cap the display so an outlier can't blow out the tabular column; the
    // real figures stay in the BILLED/COLLECTED cells beside it.
    const ratePct = expected > 0 ? Math.round((collected / expected) * 100) : null
    const rateText = ratePct === null ? '—' : ratePct > 999 ? '>999%' : `${ratePct}%`
    const datesText = c.startDate
      ? `${formatDate(c.startDate)} – ${formatDate(c.endDate)}`
      : 'Not yet opened'
    return (
      <div
        key={c.id}
        onClick={() => setSelectedId(c.id)}
        className="grid items-baseline"
        style={{
          gridTemplateColumns: CYCLE_GRID,
          gap: 12,
          minWidth: CYCLE_MIN,
          padding: '13px 0',
          borderBottom: `1px solid ${RULE_SOFT}`,
          borderLeft: `4px solid ${isActive ? SIGNAL : RULE_SOFT}`,
          paddingLeft: 12,
          cursor: 'pointer',
          background: isSelected ? 'var(--color-surface)' : undefined,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {/* Title is a direct link into the term's own page — the row click
              still selects it for the inline lifecycle below, but the title is
              the discoverable way to drill in without hunting for the overview
              button. */}
          <Link
            href={`/fees/cycles/${c.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[15px] font-semibold hover:underline"
            style={{ color: INK }}
          >
            {c.name}
          </Link>
          <p className="m-num text-[12px] mt-0.5" style={{ color: META }}>{datesText}</p>
        </div>
        <span className="m-num text-right text-[14px]" style={{ color: BODY }}>{billedText}</span>
        <span className="m-num text-right text-[14px]" style={{ color: collected > 0 ? LEDGER : DIM }}>{collectedText}</span>
        <span className="m-num text-right text-[14px] font-semibold" style={{ color: INK }}>{rateText}</span>
        <span className="text-right text-[12px] font-semibold tracking-[0.08em]" style={{ color: st.ink }}>{st.label}</span>
      </div>
    )
  }

  const selectedState = selectedCycle ? stateText(selectedCycle.status) : null

  // The selected-term header's right-hand label. For a draft it reads its
  // readiness ("READY" / "N TO DO" / "PAST SESSION") rather than a flat
  // "DRAFT", so the at-a-glance state answers "can this go live yet" before the
  // steps below spell it out.
  let selectedHeaderLabel = selectedState?.label ?? ''
  let selectedHeaderInk = selectedState?.ink ?? INK
  if (selectedCycle) {
    if (selectedCycle.status === 'active' && selectedCycle.dueDate) {
      selectedHeaderLabel = `ACTIVE · CLOSES ${formatDate(selectedCycle.dueDate).toUpperCase()}`
    } else if (selectedCycle.status === 'closed' && selectedCycle.closedAt) {
      selectedHeaderLabel = `CLOSED · ${formatDate(selectedCycle.closedAt).toUpperCase()}`
    } else if (selectedCycle.status === 'draft' && draftReadiness) {
      if (draftReadiness.isPastSession) {
        selectedHeaderLabel = 'DRAFT · PAST SESSION'
        selectedHeaderInk = META
      } else if (draftReadiness.ready) {
        selectedHeaderLabel = 'DRAFT · READY'
        selectedHeaderInk = INK
      } else {
        selectedHeaderLabel = `DRAFT · ${draftReadiness.todo.length} TO DO`
        selectedHeaderInk = OCHRE
      }
    }
  }

  return (
    <>
      <div className="m-anim-fade">
        {/* Terms section header */}
        <div className="flex flex-wrap items-end justify-between gap-5 mb-[18px]">
          <div>
            <h2 className="text-[25px] font-extrabold" style={{ color: INK, margin: 0 }}>Terms</h2>
            <p className="text-[14px] mt-1" style={{ color: BODY, maxWidth: '62ch' }}>
              Every term the school has billed, newest first. The current term carries its own progress; the rest are a record.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canManageFeeStructure && (
              <button onClick={openCreate} className="m-btn m-btn-primary">Create term</button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 pl-3 py-2 border-l-2 border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
            {error}
          </div>
        )}

        {unmatchedAdjustments.length > 0 && (
          <div className="mb-4 pl-3 py-2 border-l-2 border-[var(--color-ochre)] flex items-start justify-between gap-3">
            <p className="text-sm text-[var(--color-ochre-text)]">
              {unmatchedAdjustments.length} fee opt-in/exemption{unmatchedAdjustments.length === 1 ? '' : 's'} couldn&apos;t be matched to a fee item in the new term and{unmatchedAdjustments.length === 1 ? " wasn't" : " weren't"} carried forward.
            </p>
            <button
              onClick={() => setUnmatchedAdjustments([])}
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ochre-text)] hover:text-[var(--color-ink)] flex-shrink-0"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeSessionWrappedUp && activeSessionRow && (
          <div className="mb-6 pl-3 py-2 border-l-2 border-[var(--color-ink)] flex items-start justify-between gap-4 flex-wrap">
            <p className="text-sm" style={{ color: BODY }}>
              <strong style={{ color: INK }}>{activeSessionRow.name}</strong> has no more terms to activate. If the academic year is done, run Year-End Rollover to promote students and open the next one.
            </p>
            {canRunYearEnd && (
              <Link href="/fees/year-end" className="m-btn m-btn-outline m-btn-sm whitespace-nowrap">
                Go to Year-End Rollover
              </Link>
            )}
          </div>
        )}

        {allTermsClosed && lastClosedCycle && (
          <div className="mb-6 p-4 bg-[var(--color-ink)] flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-[var(--color-paper)]">
              <strong>{lastClosedCycle.name}</strong> is closed. You can now start a new session
              {lastClosedCycle.sessionName && <> for <strong>{suggestNextSessionName(lastClosedCycle.sessionName)}</strong></>}.
            </p>
            {canManageFeeStructure && (
              <button
                onClick={openCreateNewSession}
                className="px-4 py-2 bg-[var(--color-paper)] text-[var(--color-ink)] text-sm font-semibold hover:bg-[var(--color-surface)] whitespace-nowrap"
              >
                Start new session
              </button>
            )}
          </div>
        )}

        <div className="grid gap-6 grid-cols-1">
          <div className="min-w-0">

            {!hasAnyTerms ? (
              <div className="py-12 border-t-2" style={{ borderColor: INK, maxWidth: '60ch' }}>
                <p className="text-[17px] font-bold mb-2" style={{ color: INK }}>No terms yet</p>
                <p className="text-[14px] leading-[1.55] mb-4" style={{ color: 'var(--color-neutral-800)' }}>
                  A term is what invoices attach to, so nothing can be billed until one exists. It needs a name
                  and a due date. Most schools name them the way the calendar does: First, Second, Third.
                </p>
                {canManageFeeStructure && (
                  <button onClick={openCreate} className="m-btn m-btn-primary">Create term</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* Terms table header */}
                <div
                  className="grid"
                  style={{ gridTemplateColumns: CYCLE_GRID, gap: 12, minWidth: CYCLE_MIN, padding: '0 0 8px 16px', borderBottom: `2px solid ${INK}` }}
                >
                  <span className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: META }}>TERM</span>
                  <span className="text-right text-[11px] font-semibold tracking-[0.1em]" style={{ color: META }}>BILLED</span>
                  <span className="text-right text-[11px] font-semibold tracking-[0.1em]" style={{ color: META }}>COLLECTED</span>
                  <span className="text-right text-[11px] font-semibold tracking-[0.1em]" style={{ color: META }}>RATE</span>
                  <span className="text-right text-[11px] font-semibold tracking-[0.1em]" style={{ color: META }}>STATE</span>
                </div>

                {cyclesBySession.sortedGroups.map(group => (
                  <div key={group.sessionId || group.sessionName}>
                    <div style={{ minWidth: CYCLE_MIN, padding: '18px 0 6px 16px', borderBottom: `1px solid ${RULE_SOFT}` }}>
                      <span className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: INK }}>
                        {group.sessionName.toUpperCase()}{/\bSESSION\b/i.test(group.sessionName) ? '' : ' SESSION'}
                      </span>
                    </div>
                    {group.cycles.map(renderTermRow)}
                  </div>
                ))}

                {cyclesBySession.ungrouped.length > 0 && (
                  <div>
                    <div style={{ minWidth: CYCLE_MIN, padding: '18px 0 6px 16px', borderBottom: `1px solid ${RULE_SOFT}` }}>
                      <span className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: INK }}>NO SESSION</span>
                    </div>
                    {cyclesBySession.ungrouped.map(renderTermRow)}
                  </div>
                )}
              </div>
            )}

            {/* Selected-term lifecycle */}
            {selectedCycle && selectedState && (
              <div style={{ borderTop: `2px solid ${INK}`, marginTop: 32, paddingTop: 20 }}>
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
                  <h2 className="text-[25px] font-extrabold" style={{ color: INK, margin: 0 }}>
                    <Link href={`/fees/cycles/${selectedCycle.id}`} className="hover:underline" style={{ color: INK }}>
                      {selectedCycle.name}{selectedCycle.sessionName ? ` ${selectedCycle.sessionName}` : ''}
                    </Link>
                  </h2>
                  <span className="text-[12px] font-semibold tracking-[0.08em]" style={{ color: selectedHeaderInk }}>
                    {selectedHeaderLabel}
                  </span>
                </div>

                {selectedCycle.status === 'active' && (
                  <>
                    <p className="text-[14px] mb-5" style={{ color: BODY, maxWidth: '70ch' }}>
                      A term moves through four states. Here they are one visible sequence, so you can always see what has happened and what the next irreversible step will do before you take it.
                    </p>
                    {steps.map(renderStep)}
                    {/* Everyday quick actions for the active term, plus manage
                        (undo activation, full overview) — one line, no
                        drill-in required. Back to draft is only offered while
                        nothing has been sent to parents, matching the server
                        guard in reopenTermAsDraft. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-5">
                      {canManageFeeStructure && (
                        <Link href={`/fees/structure?cycle=${selectedCycle.id}&from=${encodeURIComponent(`/fees/cycles?cycle=${selectedCycle.id}`)}`} className="text-[13px] font-semibold hover:underline" style={{ color: INK }}>
                          Edit fees
                        </Link>
                      )}
                      {/* "Generate N missing" lives once now, as step 01's own
                          action above (with its progress bar and state label)
                          — this line used to repeat the exact same button. */}
                      {selectedCycle.invoiceCount > 0 && (
                        <a href={`/api/cycles/${selectedCycle.id}/pdf`} download className="text-[13px] font-semibold hover:underline" style={{ color: INK }}>
                          Print all invoices ({selectedCycle.invoiceCount})
                        </a>
                      )}
                      {canManageFeeStructure && selectedCycle.canUndoActivation && (
                        <button onClick={() => handleReopenAsDraft(selectedCycle)} className="text-[13px] font-semibold hover:underline" style={{ color: META }}>
                          Undo activation
                        </button>
                      )}
                      <Link href={`/fees/cycles/${selectedCycle.id}`} className="text-[13px] font-semibold hover:underline" style={{ color: INK }}>
                        View term overview
                      </Link>
                    </div>
                  </>
                )}

                {selectedCycle.status === 'draft' && draftReadiness && (
                  <>
                    <p className="text-[17px] font-bold" style={{ color: draftReadiness.headlineInk, margin: '0 0 4px' }}>
                      {draftReadiness.headline}
                    </p>
                    <p className="text-[14px] mb-5" style={{ color: BODY, maxWidth: '70ch' }}>
                      {draftReadiness.subtext}
                    </p>

                    {/* Required before go-live: dates and fees. Grouped and
                        labelled so the required-vs-optional split carries real
                        weight, not just a state word on the right. */}
                    <p className="text-[11px] font-semibold tracking-[0.12em]" style={{ color: META, margin: '0 0 2px' }}>
                      REQUIRED BEFORE ACTIVATING
                    </p>
                    {draftSteps.map(renderStepLite)}

                    {draftOptional && (
                      <>
                        <p className="text-[11px] font-semibold tracking-[0.12em]" style={{ color: META, margin: '22px 0 2px' }}>
                          OPTIONAL
                        </p>
                        <div
                          className="grid items-start"
                          style={{ gridTemplateColumns: '34px minmax(0,1fr) auto', gap: 16, padding: '16px 0', borderBottom: `1px solid ${RULE_SOFT}` }}
                        >
                          <span className="m-num text-[13px] font-extrabold" style={{ color: draftOptional.numInk, paddingTop: 2 }}>{draftOptional.n}</span>
                          <div style={{ minWidth: 0 }}>
                            <p className="text-[16px] font-bold" style={{ color: INK, margin: '0 0 3px' }}>{draftOptional.title}</p>
                            <p className="text-[13px]" style={{ color: BODY, margin: 0, lineHeight: 1.5 }}>{draftOptional.body}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[12px] font-semibold tracking-[0.08em]" style={{ color: draftOptional.stateInk, margin: '0 0 8px' }}>{draftOptional.stateLabel}</p>
                            <div className="flex items-center justify-end gap-2 flex-wrap">
                              {selectedCycle.invoiceCount > 0 && (
                                <a href={`/api/cycles/${selectedCycle.id}/pdf`} download className="m-btn m-btn-outline m-btn-sm uppercase tracking-[0.04em]">
                                  Print all invoices ({selectedCycle.invoiceCount})
                                </a>
                              )}
                              {draftOptional.action && (
                                <button onClick={draftOptional.action.onClick} className="m-btn m-btn-outline m-btn-sm uppercase tracking-[0.04em]">
                                  {draftOptional.action.label}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Activation, numbered 04 to match the active term's
                        four-step sequence — same row shape as steps above,
                        just with a plain preview of what activating does in
                        real numbers instead of a progress bar. The button is
                        only the clear culminating primary when the term is
                        ready; until then it's disabled with the reason, and
                        the required steps above are the emphasized next
                        actions. */}
                    <div
                      className="grid items-start"
                      style={{ gridTemplateColumns: '34px minmax(0,1fr) auto', gap: 16, padding: '16px 0' }}
                    >
                      <span className="m-num text-[13px] font-extrabold" style={{ color: draftReadiness.ready ? INK : DIM, paddingTop: 2 }}>04</span>
                      <div style={{ minWidth: 0 }}>
                        <p className="text-[16px] font-bold" style={{ color: INK, margin: '0 0 6px' }}>Activate this term</p>
                        <div className="text-[13px]" style={{ color: BODY, lineHeight: 1.6 }}>
                          {activeCycle ? (
                            <p style={{ margin: '0 0 4px' }}>
                              <span style={{ fontWeight: 600, color: INK }}>{activeCycle.name}</span> is the live term now, and activating this closes it first — you&apos;ll review and confirm that separately before this term goes live.{' '}
                              {activeCycle.studentsWithOutstanding > 0
                                ? (showFinancials
                                    ? <>Its <span className="m-num">{formatNaira(activeCycle.totalOutstanding)}</span> of unpaid balances from {activeCycle.studentsWithOutstanding} {activeCycle.studentsWithOutstanding === 1 ? 'student' : 'students'} carries forward onto this term.</>
                                    : <>Unpaid balances from {activeCycle.studentsWithOutstanding} {activeCycle.studentsWithOutstanding === 1 ? 'student' : 'students'} carry forward onto this term.</>)
                                : 'It has no unpaid balances to carry forward.'}
                            </p>
                          ) : (
                            <p style={{ margin: '0 0 4px' }}>No term is live right now, so nothing gets closed. This becomes your first live term.</p>
                          )}
                          <p style={{ margin: 0 }}>
                            This term will bill <span className="m-num">{selectedCycle.totalActiveStudents}</span> active {selectedCycle.totalActiveStudents === 1 ? 'student' : 'students'}.{' '}
                            {selectedCycle.invoiceCount > 0
                              ? `${selectedCycle.invoiceCount} ${selectedCycle.invoiceCount === 1 ? 'invoice is' : 'invoices are'} already drafted and go live the moment you activate.`
                              : 'You can generate their invoices right after activating.'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {(() => {
                          // A short factual line instead of a pass/fail READY
                          // pill — matching the Close term page's approach of
                          // stating what's true rather than issuing a verdict.
                          // The draft's own setup (dates/fees) still legitimately
                          // gates the button below; what changed is that a
                          // "ready" draft no longer implies the live term it's
                          // about to close is itself wrapped up. Nothing here
                          // blocks activating — it only states what's pending.
                          let text: string
                          let ink: string
                          if (draftReadiness.isPastSession) {
                            text = "A past-year term can't be activated."
                            ink = META
                          } else if (!draftReadiness.ready) {
                            text = `Do ${draftReadiness.todo.length === 1 ? 'this' : 'these'} first: ${draftReadiness.todo.join(', and ')}.`
                            ink = OCHRE
                          } else if (activeTermPending.length > 0) {
                            text = `${activeCycle!.name} still has ${activeTermPending.join(', ')} — activating routes you to close it first.`
                            ink = OCHRE
                          } else {
                            text = activeCycle ? `${activeCycle.name} is fully wrapped up.` : 'Nothing else to do first.'
                            ink = META
                          }
                          return (
                            <p className="text-[12px] font-semibold" style={{ color: ink, margin: '0 0 8px', maxWidth: 220 }}>{text}</p>
                          )
                        })()}
                        {canManageFeeStructure && (
                          <button
                            onClick={() => handleActivate(selectedCycle)}
                            disabled={!draftReadiness.ready}
                            className="m-btn m-btn-primary m-btn-sm uppercase tracking-[0.04em]"
                          >
                            Activate term
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-6" style={{ borderTop: `2px solid ${INK}`, paddingTop: 20 }}>
                      {canManageFeeStructure && (
                        <button onClick={() => handleDeleteDraft(selectedCycle)} className="text-[13px] font-semibold hover:underline" style={{ color: SIGNAL }}>
                          Delete draft
                        </button>
                      )}
                      <Link href={`/fees/cycles/${selectedCycle.id}`} className="text-[13px] font-semibold hover:underline" style={{ color: INK }}>
                        View term overview
                      </Link>
                    </div>
                  </>
                )}

                {selectedCycle.status === 'closed' && (
                  <>
                    <p className="text-[14px] mb-5" style={{ color: BODY, maxWidth: '70ch' }}>
                      {selectedCycle.studentsWithOutstanding > 0
                        ? 'This term is closed and read-only. Payments can still be recorded against the outstanding balance below.'
                        : 'This term is closed and read-only. Every invoice was fully collected.'}
                    </p>
                    {closedSteps.map(renderStep)}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-5">
                      {selectedCycle.invoiceCount > 0 && (
                        <a href={`/api/cycles/${selectedCycle.id}/pdf`} download className="text-[13px] font-semibold hover:underline" style={{ color: INK }}>
                          Print all invoices ({selectedCycle.invoiceCount})
                        </a>
                      )}
                      <Link href={`/fees/cycles/${selectedCycle.id}`} className="text-[13px] font-semibold hover:underline" style={{ color: INK }}>
                        View term overview
                      </Link>
                    </div>
                  </>
                )}
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
              onSuccess={(summary, unmatched) => {
                closePanel()
                if (summary && summary.closedTermName) {
                  setCarryForwardSummary({ mode: 'activated', ...summary })
                  trackCloseTermJobIfAny(summary.jobId, summary.invoicesUpdated)
                }
                setUnmatchedAdjustments(unmatched && unmatched.length > 0 ? unmatched : [])
                router.refresh()
              }}
            />
          )}
        </div>
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

      {lifecycleSendOpen && selectedCycle && (
        <BulkSendInvoicesPanel
          count={selectedCycle.invoicesUnsent + selectedCycle.invoicesNeedingResend}
          onClose={() => { setLifecycleSendOpen(false); router.refresh() }}
        />
      )}

      {/* In-place invoice generation for the selected term — opened by the
          quick actions on the list so "generate" never requires a drill-in. */}
      {generateCycleId && (
        <GenerateInvoicesPanel
          cycleId={generateCycleId}
          onClose={() => setGenerateCycleId(null)}
          onSuccess={() => { setGenerateCycleId(null); router.refresh() }}
        />
      )}

      {/* Post-close / post-activate carry-forward summary */}
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
