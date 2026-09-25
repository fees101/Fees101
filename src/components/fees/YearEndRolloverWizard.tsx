'use client'

// The Year end tab. Its LANDING screen replicates the App Shell "Year end"
// canvas (mockup redesign/App Shell.dc.html, the fees:3 seqLedger render): the
// pre-run ledger IS the first thing the user sees, computed from real current
// data with sensible defaults (auto class-ladder promotion, next session
// auto-named and auto-dated) so it renders with no input. Only after the
// canvas's "Run year-end rollover" button is pressed do the input phases appear
// (new-year detail adjustments, per-student promotion review, then the final
// type-to-confirm run). This follows the redesign's canvas-first rule: the
// canvas is what the landing must be, and any flow we invent comes after its
// entry button.
//
// Flush-left, 2px ink section rules, 1px hairline rows, no tinted boxes. Colour
// carries meaning and nothing else does: ink for a neutral fact, ochre for
// money/balances awaiting a human, dim for a zero, signal red only on the
// irreversible action. The underlying rollover logic (startYearEndRollover ->
// continueYearEndRollover) is unchanged — this is the surface over it.

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { startYearEndRollover, resumeYearEndRollover, cancelYearEndRollover, getRolloverStatus } from '@/app/(app)/fees/cycles/actions'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import { PromotionPreviewGroup, PromotionDecision } from '@/lib/yearEnd/promotion'
import { DraftSession, YearEndFeeCopyPreview, YearEndReadiness } from '@/app/(app)/fees/year-end/actions'

const INK = 'var(--color-ink)'
const BODY = 'var(--color-neutral-800)'
const DIM = 'var(--color-neutral-500)'
const RULE_SOFT = '#d7d3d3'
const OCHRE = 'var(--color-ochre-text)'
const SIGNAL_TEXT = 'var(--color-signal-text)'

function naira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

// "2026/2027" -> "2027/2028"; "2026/27" -> "2027/28". Returns '' when the
// current session name isn't a recognisable year pair, so the surface falls
// back to a manual name rather than inventing one.
function deriveNextSessionName(prev: string): string {
  const m = (prev || '').match(/(\d{4})\D+(\d{2,4})/)
  if (!m) return ''
  const a = parseInt(m[1], 10) + 1
  const b = a + 1
  return m[2].length === 2 ? `${a}/${String(b).slice(-2)}` : `${a}/${b}`
}

// Sensible Nigerian-calendar defaults for the new session/term, derived from
// the next session's start year. These pre-fill the after-the-button form so a
// straight-through run matches exactly what the landing ledger promised; the
// admin can still adjust every field.
function defaultDatesFor(nextName: string): {
  sessionStart: string; sessionEnd: string; termStart: string; termEnd: string; termDue: string
} {
  const m = (nextName || '').match(/(\d{4})/)
  if (!m) return { sessionStart: '', sessionEnd: '', termStart: '', termEnd: '', termDue: '' }
  const y = parseInt(m[1], 10)
  return {
    sessionStart: `${y}-09-01`,
    sessionEnd: `${y + 1}-07-31`,
    termStart: `${y}-09-01`,
    termEnd: `${y}-12-15`,
    termDue: `${y}-09-30`,
  }
}

function csvCell(v: string | number): string {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"'
}

function actionLabel(action: 'promote' | 'repeat' | 'graduate'): string {
  return action === 'promote' ? 'Promote' : action === 'repeat' ? 'Repeat class' : 'Graduate / exit'
}

interface ClassOption {
  id: string
  name: string
}

interface RolloverRun {
  id: string
  status: 'in_progress' | 'failed' | 'completed'
  step: string
  error_detail: string | null
  from_cycle_id: string
  to_cycle_id: string | null
  created_at: string
}

interface Props {
  activeRun: RolloverRun | null
  groups: PromotionPreviewGroup[]
  classes: ClassOption[]
  previewError: string | null
  draftSessions: DraftSession[]
  feeCopyPreview: YearEndFeeCopyPreview | null
  readiness: YearEndReadiness | null
  showFinancials: boolean
}

type RowDecision = { action: 'promote' | 'repeat' | 'graduate'; targetClassId: string }

type WizardStep = 'landing' | 'details' | 'readiness' | 'promotions' | 'balances' | 'confirm'

type RolloverResult = {
  toCycleId: string | null
  exitInvoiceWarnings: { studentId: string; invoiceId: string }[]
  regeneratedCount: number
  regenerateErrors: { studentId: string; error: string }[]
  unmatchedAdjustments: { studentId: string; feeItemName: string }[]
  staleDraftsClosed: number
  staleDraftWarnings: { sessionId: string; sessionName: string }[]
}

const FLOW_STEPS: { key: WizardStep; label: string }[] = [
  { key: 'details', label: 'New year details' },
  { key: 'readiness', label: 'Readiness checks' },
  { key: 'promotions', label: 'Promotion tree' },
  { key: 'balances', label: 'Balances' },
  { key: 'confirm', label: 'Commit' },
]

// The flow stepper. Exact states from the redesign brief:
//   ACTIVE    -> filled ink block, title in white, number hidden.
//   COMPLETED -> paper block, title in ink, number in ledger green.
//   UPCOMING  -> paper block, number and title in dim grey.
// Blocks sit in one bordered strip separated by 2px ink rules. No radius, no
// shadow. Horizontally scrollable at narrow widths so it never breaks the page.
function StepStrip({ current }: { current: WizardStep }) {
  const currentIdx = FLOW_STEPS.findIndex(s => s.key === current)
  return (
    <div style={{ overflowX: 'auto', marginTop: 4 }}>
      <div style={{ display: 'flex', border: `2px solid ${INK}`, minWidth: 640 }}>
        {FLOW_STEPS.map((s, i) => {
          const active = i === currentIdx
          const completed = i < currentIdx
          const num = String(i + 1).padStart(2, '0')
          return (
            <div
              key={s.key}
              style={{
                flex: 1,
                minWidth: 0,
                background: active ? INK : 'transparent',
                borderLeft: i > 0 ? `2px solid ${INK}` : 'none',
                padding: '10px 14px',
                display: 'flex',
                gap: 8,
                alignItems: 'baseline',
              }}
            >
              {!active && (
                <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: completed ? INK : DIM }}>
                  {num}
                </span>
              )}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: active ? 700 : 600,
                  whiteSpace: 'nowrap',
                  color: active ? '#ffffff' : completed ? INK : DIM,
                }}
              >
                {s.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface LedgerRowProps {
  what: string
  val: string
  ink: string
  sub?: string
}

function LedgerRow({ what, val, ink, sub }: LedgerRowProps) {
  return (
    <div style={{ padding: '11px 0', borderTop: `1px solid ${RULE_SOFT}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 16, alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, color: ink }}>{what}</span>
        <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: ink }}>{val}</span>
      </div>
      {sub && <p style={{ fontSize: 13, color: BODY, margin: '4px 0 0', maxWidth: '64ch' }}>{sub}</p>}
    </div>
  )
}

function LeftRuleNote({ children, tone = OCHRE }: { children: React.ReactNode; tone?: string }) {
  return (
    <p style={{ fontSize: 14, color: tone, margin: '12px 0 0', paddingLeft: 12, borderLeft: `2px solid ${tone}`, maxWidth: '72ch', lineHeight: 1.5 }}>
      {children}
    </p>
  )
}

export default function YearEndRolloverWizard({ activeRun, groups, classes, previewError, draftSessions, feeCopyPreview, readiness, showFinancials }: Props) {
  const router = useRouter()

  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)

  // Mirrors the `activeRun` server prop but updates from polling below, so a
  // run resumed in the background by the rollover cron sweep (no button
  // click, no reload) still shows live progress here.
  const [polledRun, setPolledRun] = useState<RolloverRun | null>(activeRun)
  useEffect(() => {
    setPolledRun(activeRun)
  }, [activeRun])

  // Auto-poll getRolloverStatus while a run is 'in_progress' — the cron
  // sweep (src/app/api/admin/rollover-sweep) can advance a stalled run at
  // any time with nobody watching this page, so this can't wait for a
  // manual click/reload to reflect that.
  useEffect(() => {
    if (!polledRun || polledRun.status !== 'in_progress') return
    let cancelled = false
    const interval = setInterval(async () => {
      const statusResult = await getRolloverStatus()
      if (cancelled || !('run' in statusResult)) return
      const latest = statusResult.run
      if (!latest) {
        // No longer in_progress/failed — it finished. The rich per-run
        // summary (regeneratedCount, warnings, etc.) only ever comes back
        // from the mutating call itself and is never persisted, so a
        // completion nobody clicked "Resume" for can't render that screen —
        // refresh to the normal landing view instead.
        router.refresh()
        return
      }
      if (latest.status !== polledRun.status || latest.step !== polledRun.step || latest.error_detail !== polledRun.error_detail) {
        setPolledRun(latest as RolloverRun)
      }
    }, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [polledRun, router])

  const [step, setStep] = useState<WizardStep>('landing')

  // Promotion tree (step 03) is a master-detail: the class ladder is always
  // visible, but only ONE class's student list opens at a time so the page
  // never becomes a scroll through every student in the school. null = all
  // collapsed (the clean-year confirm-at-a-glance state).
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null)

  // 'new' creates a fresh session+term (default when nothing's been prepared ahead of time);
  // 'adopt' rolls into a session that was already drafted (e.g. via Academic Structure → Sessions).
  const [sessionSource, setSessionSource] = useState<'new' | 'adopt'>(draftSessions.length > 0 ? 'adopt' : 'new')
  const [adoptSessionId, setAdoptSessionId] = useState(draftSessions[0]?.id || '')
  const [adoptCycleId, setAdoptCycleId] = useState('')

  const adoptedSession = useMemo(() => draftSessions.find(s => s.id === adoptSessionId), [draftSessions, adoptSessionId])
  const adoptingExistingTerm = sessionSource === 'adopt' && !!adoptCycleId

  // Pre-fill the new-session/term inputs from the auto-derived next session so
  // the landing ledger renders with no input AND a straight-through run creates
  // exactly what the landing promised.
  const initialNext = deriveNextSessionName(feeCopyPreview?.fromSessionName || '')
  const initialDates = defaultDatesFor(initialNext)
  const [name, setName] = useState(initialNext ? `First Term ${initialNext}` : '')
  const [startDate, setStartDate] = useState(initialDates.termStart)
  const [endDate, setEndDate] = useState(initialDates.termEnd)
  const [dueDate, setDueDate] = useState(initialDates.termDue)
  const [newSessionName, setNewSessionName] = useState(initialNext)
  const [newSessionStart, setNewSessionStart] = useState(initialDates.sessionStart)
  const [newSessionEnd, setNewSessionEnd] = useState(initialDates.sessionEnd)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  const [decisions, setDecisions] = useState<Record<string, RowDecision>>(() => {
    const initial: Record<string, RowDecision> = {}
    for (const group of groups) {
      for (const row of group.students) {
        initial[row.studentId] = {
          action: row.suggestedAction,
          targetClassId: row.suggestedTargetClassId || '',
        }
      }
    }
    return initial
  })

  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<RolloverResult | null>(null)

  // What the admin must type to confirm — the adopted session's name when
  // rolling into a prepared session, otherwise the new session name (pre-filled
  // from the auto-derived next session, editable in the details step).
  const expectedConfirmName = sessionSource === 'adopt' ? (adoptedSession?.name || '') : newSessionName

  const summary = useMemo(() => {
    let promote = 0, repeat = 0, graduate = 0
    Object.values(decisions).forEach(d => {
      if (d.action === 'promote') promote++
      else if (d.action === 'repeat') repeat++
      else graduate++
    })
    return { promote, repeat, graduate, total: promote + repeat + graduate }
  }, [decisions])

  // Outstanding owed on the term being rolled from, per student.
  const outstandingByStudent = useMemo(() => {
    const m: Record<string, number> = {}
    for (const g of groups) for (const r of g.students) m[r.studentId] = r.outstandingAmount || 0
    return m
  }, [groups])

  // Splits owed money by what happens to the student: a promoted or repeating
  // student's balance rides forward onto the new session's first-term invoice
  // (when it is generated); a graduating leaver's balance carries nowhere — it
  // stays on their final, now-closed invoice.
  const balancePreview = useMemo(() => {
    let carryStudents = 0, carryAmount = 0, leaverStudents = 0, leaverAmount = 0
    for (const [studentId, d] of Object.entries(decisions)) {
      const owed = outstandingByStudent[studentId] || 0
      if (owed <= 0) continue
      if (d.action === 'graduate') { leaverStudents++; leaverAmount += owed }
      else { carryStudents++; carryAmount += owed }
    }
    return { carryStudents, carryAmount, leaverStudents, leaverAmount }
  }, [decisions, outstandingByStudent])

  // The class(es) whose students are exiting under the current decisions. When
  // there's a single exit class (the usual case: the top class), name it, the
  // way the canvas row does ("SS 3 students graduated and archived").
  const exitClassLabel = useMemo(() => {
    const s = new Set<string>()
    for (const g of groups) for (const r of g.students) {
      if ((decisions[r.studentId]?.action) === 'graduate') s.add(g.className)
    }
    const names = Array.from(s)
    return names.length === 1 ? `${names[0]} students graduated and archived` : 'Students graduated and archived'
  }, [groups, decisions])

  // Per-class ladder for the promotion-tree step: where each class sends its
  // students under the current decisions, and how many go each way. A class is
  // an exit point when every one of its students is graduating.
  const ladder = useMemo(() => {
    return groups.map(g => {
      let promote = 0, repeat = 0, graduate = 0, overrides = 0
      const targets = new Set<string>()
      for (const r of g.students) {
        const d = decisions[r.studentId]
        const action = d?.action || 'promote'
        if (action === 'promote') { promote++; if (d?.targetClassId) targets.add(classes.find(c => c.id === d.targetClassId)?.name || '') }
        else if (action === 'repeat') repeat++
        else graduate++
        // "Overridden" = the admin moved this student off the ladder's own
        // suggestion (a different action, or a promote pointed at a different
        // class). Counted so nothing changed by hand slips through silently.
        const changed = d
          ? d.action !== r.suggestedAction ||
            (d.action === 'promote' && (d.targetClassId || '') !== (r.suggestedTargetClassId || ''))
          : false
        if (changed) overrides++
      }
      const targetNames = Array.from(targets).filter(Boolean)
      const toLabel = promote === 0
        ? 'Graduate / exit'
        : targetNames.length === 1
          ? targetNames[0]
          : targetNames.length > 1
            ? `${targetNames.length} classes`
            : 'next class'
      return { classId: g.classId, className: g.className, count: g.students.length, promote, repeat, graduate, overrides, toLabel, isExit: promote === 0 }
    })
  }, [groups, decisions, classes])

  const overriddenTotal = useMemo(() => ladder.reduce((n, l) => n + l.overrides, 0), [ladder])

  // Readiness checks for step 02. Each maps onto something we can actually
  // compute — server facts (readiness prop: current-session terms, pending
  // discounts, provider) plus client facts (the promotion ladder and carried
  // balances). tone drives colour and whether it blocks: 'hard' disables
  // Continue; 'warn'/'info'/'pass' never block.
  const checks = useMemo(() => {
    type Check = {
      key: string
      title: string
      desc: string
      tone: 'pass' | 'info' | 'warn' | 'hard'
      status: string
      action?: { label: string; href: string }
    }
    const out: Check[] = []

    // Term to roll from — always satisfied here (the surface is gated by
    // previewError before this), shown so the user sees the source explicitly.
    out.push({
      key: 'source',
      title: 'Term to roll from',
      desc: readiness
        ? `Rolling from ${readiness.fromTermName}${readiness.currentSessionName ? ` in ${readiness.currentSessionName}` : ''}. The rollover closes this term itself.`
        : 'An active term is set as the source for the rollover.',
      tone: 'pass',
      status: 'Ready',
    })

    // Promotion ladder health. If nothing promotes while more than one class
    // exists, the class ladder is unset and running now would graduate the
    // whole school — the one hard block in this flow.
    const ladderPromote = groups.reduce((n, g) => n + g.students.filter(r => r.suggestedAction === 'promote').length, 0)
    const classCount = groups.length
    if (ladderPromote === 0 && classCount > 1) {
      out.push({
        key: 'ladder',
        title: 'Class promotion ladder',
        desc: 'No class has a next class set, so every student would graduate. Set each class’s next class in Academic structure before running year end.',
        tone: 'hard',
        status: 'Must fix',
        action: { label: 'Set up ladder', href: '/school/academic-structure' },
      })
    } else {
      const exitClasses = groups.filter(g => g.students.every(r => r.suggestedAction === 'graduate')).length
      out.push({
        key: 'ladder',
        title: 'Class promotion ladder',
        desc: `${classCount - exitClasses} class${classCount - exitClasses === 1 ? '' : 'es'} promote${classCount - exitClasses === 1 ? 's' : ''} up the ladder; ${exitClasses} exit${exitClasses === 1 ? 's' : ''} (students graduate). Review and override per student in the next step.`,
        tone: exitClasses > 0 ? 'info' : 'pass',
        status: 'Reviewed next',
      })
    }

    // Leftover draft term in the current session (soft: allowed).
    if (readiness) {
      const draftTerms = readiness.terms.filter(t => t.status === 'draft')
      if (draftTerms.length > 0) {
        out.push({
          key: 'draft-term',
          title: 'Unfinished term in this session',
          desc: `${draftTerms.map(t => t.name).join(', ')} ${draftTerms.length === 1 ? 'is' : 'are'} still a draft. That is allowed — the rollover runs from the active term and leaves drafts as they are.`,
          tone: 'warn',
          status: 'Allowed',
        })
      } else {
        out.push({
          key: 'draft-term',
          title: 'Unfinished term in this session',
          desc: 'No term is left drafting in this session.',
          tone: 'pass',
          status: 'Clear',
        })
      }

      // Every term has an end date.
      const undated = readiness.terms.filter(t => !t.endDate)
      if (undated.length > 0) {
        out.push({
          key: 'dates',
          title: 'Term dates',
          desc: `${undated.map(t => t.name).join(', ')} ${undated.length === 1 ? 'has' : 'have'} no end date set. The rollover still runs, but term dates should be complete for accurate records.`,
          tone: 'warn',
          status: 'Incomplete',
        })
      } else {
        out.push({
          key: 'dates',
          title: 'Term dates',
          desc: 'Every term in this session has start and end dates.',
          tone: 'pass',
          status: 'Complete',
        })
      }

      // Pending discount decisions (needs-a-human, soft).
      if (readiness.pendingDiscountCount > 0) {
        out.push({
          key: 'discounts',
          title: 'Discount requests awaiting a decision',
          desc: `${readiness.pendingDiscountCount} request${readiness.pendingDiscountCount === 1 ? '' : 's'} still pending. Approving or declining them first keeps the balances carried forward accurate.`,
          tone: 'warn',
          status: 'Decide first',
          action: { label: 'Decide first', href: '/discounts' },
        })
      } else {
        out.push({
          key: 'discounts',
          title: 'Discount requests awaiting a decision',
          desc: 'No discount requests are waiting for a decision.',
          tone: 'pass',
          status: 'Clear',
        })
      }
    }

    // Unpaid balances carry forward (info, computed client-side).
    if (balancePreview.carryStudents > 0) {
      out.push({
        key: 'balances',
        title: 'Unpaid balances',
        desc: showFinancials
          ? `${balancePreview.carryStudents} continuing student${balancePreview.carryStudents === 1 ? '' : 's'} owe ${naira(balancePreview.carryAmount)}. This carries into the new term — reviewed on the Balances step.`
          : `${balancePreview.carryStudents} continuing student${balancePreview.carryStudents === 1 ? '' : 's'} still owe on this term. Balances carry into the new term — reviewed on the Balances step.`,
        tone: 'info',
        status: 'Carries forward',
      })
    } else {
      out.push({
        key: 'balances',
        title: 'Unpaid balances',
        desc: 'No continuing student has an outstanding balance to carry forward.',
        tone: 'pass',
        status: 'Clear',
      })
    }

    // Payment provider (info).
    if (readiness) {
      out.push({
        key: 'provider',
        title: 'Payment provider',
        desc: readiness.provider.connected
          ? `${readiness.provider.name}${readiness.provider.mode ? ` · ${readiness.provider.mode}` : ''} is connected. Online collection continues after the rollover.`
          : 'No payment provider is connected. Year end still runs; parents just cannot pay online until one is set up.',
        tone: 'info',
        status: readiness.provider.connected ? 'Connected' : 'Not set',
      })
    }

    return out
  }, [readiness, groups, balancePreview, showFinancials])

  const hardBlockers = useMemo(() => checks.filter(c => c.tone === 'hard'), [checks])

  function setDecision(studentId: string, patch: Partial<RowDecision>) {
    setDecisions(prev => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }))
  }

  function validateDetails(): boolean {
    if (sessionSource === 'adopt') {
      if (!adoptSessionId) {
        setDetailsError('Choose a draft session to roll into')
        return false
      }
      if (!adoptCycleId && (!name.trim() || !startDate || !endDate || !dueDate)) {
        setDetailsError('Term name, start date, end date, and due date are all required')
        return false
      }
      setDetailsError(null)
      return true
    }
    if (!name.trim() || !startDate || !endDate || !dueDate) {
      setDetailsError('Term name, start date, end date, and due date are all required')
      return false
    }
    if (!newSessionName.trim() || !newSessionStart || !newSessionEnd) {
      setDetailsError('New session name, start date, and end date are all required')
      return false
    }
    setDetailsError(null)
    return true
  }

  function buildDecisionList(): PromotionDecision[] {
    // targetClassId only ever means something for 'promote' — a 'repeat'
    // row's select state can still be carrying the *promoted* class from
    // before the action was switched (see setDecision's action-change
    // handler below), so sending it for 'repeat' risked silently moving the
    // student to their would-have-been-promoted class instead of keeping
    // them put. Never send it for anything but 'promote'; the server-side
    // apply step also no-ops the class_id update whenever it's absent, so
    // 'repeat' is a guaranteed no-op on class_id regardless of this state.
    return Object.entries(decisions).map(([studentId, d]) => ({
      studentId,
      action: d.action,
      targetClassId: d.action === 'promote' ? (d.targetClassId || undefined) : undefined,
    }))
  }

  function buildNewTermPayload() {
    if (sessionSource === 'adopt') {
      return adoptCycleId
        ? { adoptSessionId, adoptCycleId }
        : { adoptSessionId, name, startDate, endDate, dueDate }
    }
    return { name, startDate, endDate, dueDate, newSessionName, newSessionStart, newSessionEnd }
  }

  async function handleSubmit() {
    if (confirmText.trim() !== expectedConfirmName.trim()) {
      setSubmitError('Type the session name exactly to confirm')
      return
    }
    setSubmitting(true)
    setSubmitError(null)

    const submitResult = await startYearEndRollover({
      decisions: buildDecisionList(),
      newTerm: buildNewTermPayload(),
      confirmSessionName: confirmText,
    })

    if ('error' in submitResult) {
      setSubmitError(submitResult.error)
      setSubmitting(false)
      return
    }

    setResult({
      toCycleId: submitResult.toCycleId || null,
      exitInvoiceWarnings: submitResult.exitInvoiceWarnings || [],
      regeneratedCount: submitResult.regeneratedCount || 0,
      regenerateErrors: submitResult.regenerateErrors || [],
      unmatchedAdjustments: submitResult.unmatchedAdjustments || [],
      staleDraftsClosed: submitResult.staleDraftsClosed || 0,
      staleDraftWarnings: submitResult.staleDraftWarnings || [],
    })
    router.refresh()
  }

  async function handleResume() {
    if (!polledRun) return
    setResuming(true)
    setResumeError(null)

    const needsNewTerm = polledRun.step === 'started'
    if (needsNewTerm && !validateDetails()) {
      setResuming(false)
      return
    }

    const resumeResult = await resumeYearEndRollover(
      polledRun.id,
      needsNewTerm ? buildNewTermPayload() : undefined
    )

    if ('error' in resumeResult) {
      setResumeError(resumeResult.error)
      setResuming(false)
      return
    }

    setResult({
      toCycleId: resumeResult.toCycleId || null,
      exitInvoiceWarnings: resumeResult.exitInvoiceWarnings || [],
      regeneratedCount: resumeResult.regeneratedCount || 0,
      regenerateErrors: resumeResult.regenerateErrors || [],
      unmatchedAdjustments: resumeResult.unmatchedAdjustments || [],
      staleDraftsClosed: resumeResult.staleDraftsClosed || 0,
      staleDraftWarnings: resumeResult.staleDraftWarnings || [],
    })
    router.refresh()
  }

  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)

  async function handleCancel() {
    if (!polledRun) return
    setCancelling(true)
    setCancelError(null)
    const cancelResult = await cancelYearEndRollover(polledRun.id)
    if ('error' in cancelResult) {
      setCancelError(cancelResult.error)
      setCancelling(false)
      return
    }
    setDiscardConfirmOpen(false)
    router.refresh()
  }

  // "Export this list first" — a real, client-only download of exactly what the
  // ledger summarises: every student, the action set for them, and (for whoever
  // can see money) the outstanding balance and whether it carries forward or is
  // stranded on a leaver's final invoice. This is the list to pursue arrears
  // against before students are archived.
  function handleExportList() {
    const header = ['Admission number', 'Student', 'Current class', 'Action', 'Target class']
    if (showFinancials) header.push('Outstanding (NGN)')
    header.push('Balance disposition')

    const lines = [header.map(csvCell).join(',')]
    for (const g of groups) {
      for (const r of g.students) {
        const d = decisions[r.studentId]
        const action = d?.action || 'promote'
        const targetName = action === 'promote'
          ? (classes.find(c => c.id === d?.targetClassId)?.name || '')
          : action === 'repeat' ? r.currentClassName : ''
        const owed = outstandingByStudent[r.studentId] || 0
        const disposition = owed <= 0
          ? 'No balance'
          : action === 'graduate'
            ? 'Stranded on final invoice (leaver, carried nowhere)'
            : 'Carries to new term'
        const cells: (string | number)[] = [r.admissionNumber, r.studentName, g.className, actionLabel(action), targetName]
        if (showFinancials) cells.push(Math.round(owed))
        cells.push(disposition)
        lines.push(cells.map(csvCell).join(','))
      }
    }

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = (feeCopyPreview?.fromSessionName || 'year-end').replace(/[^\w]+/g, '-')
    a.download = `year-end-preview-${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Session/first-term labels, resolved from whichever path is chosen. These
  // drive both the landing ledger and the final confirm ledger.
  const firstTermName = sessionSource === 'adopt'
    ? (adoptCycleId ? (adoptedSession?.terms.find(t => t.id === adoptCycleId)?.name || 'the prepared term') : (name || 'the new first term'))
    : (name || 'the new first term')
  const newSessionLabel = sessionSource === 'adopt'
    ? (adoptedSession?.name || 'the prepared session')
    : (newSessionName || initialNext || 'the new session')
  const prevSessionLabel = feeCopyPreview?.fromSessionName || 'this year'

  // Fees-copied ledger row: nothing is copied when adopting a term that already
  // has its own fees; otherwise createTerm copies the roll-forward set.
  const feesRow: LedgerRowProps = adoptingExistingTerm
    ? { what: 'Fee structure', val: 'Uses prepared term', ink: DIM }
    : feeCopyPreview && feeCopyPreview.feeItemCount > 0
      ? {
          what: 'Fee structure copied forward, prices unchanged',
          val: `${feeCopyPreview.feeItemCount} fee${feeCopyPreview.feeItemCount === 1 ? '' : 's'}${feeCopyPreview.classCount > 0 ? ` × ${feeCopyPreview.classCount} class${feeCopyPreview.classCount === 1 ? '' : 'es'}` : ''}`,
          ink: INK,
        }
      : { what: 'Fee structure copied forward', val: 'None to copy', ink: DIM }

  // ── After the run: a flush-left result surface, no modal ──────────────────
  if (result) {
    const hasWarnings = result.exitInvoiceWarnings.length > 0 || result.regenerateErrors.length > 0 || result.unmatchedAdjustments.length > 0 || result.staleDraftWarnings.length > 0
    return (
      <div style={{ maxWidth: 880 }}>
        <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
          <h2 style={{ fontSize: 25, fontWeight: 800, margin: '0 0 6px', color: INK }}>Rollover complete</h2>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: BODY, margin: '0 0 8px', maxWidth: '72ch' }}>
            Students have been promoted and the new term is active. Invoices have <strong>not</strong> been generated yet —
            confirm the new term&apos;s fee items, then generate invoices from the term page when you are ready to send them to parents.
          </p>
          {result.regeneratedCount > 0 && (
            <p style={{ fontSize: 14, color: BODY, margin: '0 0 4px', maxWidth: '72ch' }}>
              {result.regeneratedCount} previously previewed invoice{result.regeneratedCount === 1 ? '' : 's'} updated to reflect promoted students&apos; new classes.
            </p>
          )}
          {result.staleDraftsClosed > 0 && (
            <p style={{ fontSize: 14, color: BODY, margin: '0 0 4px', maxWidth: '72ch' }}>
              {result.staleDraftsClosed} old, unused draft session{result.staleDraftsClosed === 1 ? '' : 's'} left over from before this rollover {result.staleDraftsClosed === 1 ? 'was' : 'were'} closed so {result.staleDraftsClosed === 1 ? 'it can' : 'they can'}&apos;t be mistakenly activated later.
            </p>
          )}

          {result.staleDraftWarnings.length > 0 && (
            <LeftRuleNote>
              {result.staleDraftWarnings.length} old draft session{result.staleDraftWarnings.length === 1 ? '' : 's'} from before this rollover already {result.staleDraftWarnings.length === 1 ? 'has' : 'have'} invoices and {result.staleDraftWarnings.length === 1 ? 'was' : 'were'} left alone rather than closed automatically. Review and close manually from Academic structure if no longer needed: {result.staleDraftWarnings.map(w => w.sessionName).join(', ')}.
            </LeftRuleNote>
          )}
          {result.exitInvoiceWarnings.length > 0 && (
            <LeftRuleNote>
              {result.exitInvoiceWarnings.length} exiting student{result.exitInvoiceWarnings.length === 1 ? '' : 's'} had a preview invoice with payment or credit already applied. {result.exitInvoiceWarnings.length === 1 ? 'It was' : 'They were'} left as-is for manual review rather than cancelled automatically.
            </LeftRuleNote>
          )}
          {result.regenerateErrors.length > 0 && (
            <LeftRuleNote>
              {result.regenerateErrors.length} invoice{result.regenerateErrors.length === 1 ? '' : 's'} couldn&apos;t be auto-updated and may need a manual look.
            </LeftRuleNote>
          )}
          {result.unmatchedAdjustments.length > 0 && (
            <LeftRuleNote>
              {result.unmatchedAdjustments.length} fee opt-in/exemption{result.unmatchedAdjustments.length === 1 ? '' : 's'} couldn&apos;t be matched to a fee item in the new term and {result.unmatchedAdjustments.length === 1 ? 'was' : 'were'} not carried forward.
            </LeftRuleNote>
          )}
          {!hasWarnings && (
            <p style={{ fontSize: 14, color: BODY, margin: '8px 0 0', maxWidth: '72ch' }}>Everything carried forward cleanly. No issues found.</p>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22, alignItems: 'center' }}>
            <button
              onClick={() => router.push(result.toCycleId ? `/fees/cycles/${result.toCycleId}` : '/fees/cycles')}
              className="m-btn m-btn-primary"
            >
              Review new term and generate invoices
            </button>
            <button onClick={() => router.push('/fees/cycles')} className="m-btn m-btn-outline">
              Go to Cycles
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── A run already in progress or failed mid-run ───────────────────────────
  if (polledRun) {
    const needsNewTerm = polledRun.step === 'started'
    const canDiscard = polledRun.status === 'failed' && polledRun.step === 'started' && !polledRun.to_cycle_id
    return (
      <div style={{ maxWidth: 880 }}>
        <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
          <h2 style={{ fontSize: 25, fontWeight: 800, margin: '0 0 6px', color: INK }}>
            {polledRun.status === 'failed' ? 'Rollover failed mid-run' : 'Rollover in progress'}
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: BODY, margin: '0 0 8px', maxWidth: '72ch' }}>
            Last completed step: <span style={{ color: INK, fontWeight: 600 }}>{polledRun.step}</span>. Resuming picks up
            exactly where it left off — no student already promoted is promoted again.
          </p>
          {polledRun.error_detail && (
            <LeftRuleNote tone={SIGNAL_TEXT}>{polledRun.error_detail}</LeftRuleNote>
          )}
          {polledRun.status === 'in_progress' && (
            <p style={{ fontSize: 13, color: DIM, margin: '8px 0 0', maxWidth: '72ch' }}>
              Checked automatically every few seconds. A stalled run also resumes on its own, so you do not need to keep this page open or click Resume.
            </p>
          )}

          {needsNewTerm && (
            <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 28, paddingTop: 18, maxWidth: 480 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: INK }}>New term details</h3>
              <p style={{ fontSize: 14, color: BODY, margin: '0 0 16px', maxWidth: '70ch' }}>
                The new term was not created yet. Re-enter its details to continue.
              </p>
              <div className="space-y-4">
                <SessionSourceFields
                  draftSessions={draftSessions}
                  sessionSource={sessionSource} setSessionSource={setSessionSource}
                  adoptSessionId={adoptSessionId} setAdoptSessionId={setAdoptSessionId}
                  adoptCycleId={adoptCycleId} setAdoptCycleId={setAdoptCycleId}
                  adoptedSession={adoptedSession}
                  name={name} setName={setName}
                  startDate={startDate} setStartDate={setStartDate}
                  endDate={endDate} setEndDate={setEndDate}
                  dueDate={dueDate} setDueDate={setDueDate}
                  newSessionName={newSessionName} setNewSessionName={setNewSessionName}
                  newSessionStart={newSessionStart} setNewSessionStart={setNewSessionStart}
                  newSessionEnd={newSessionEnd} setNewSessionEnd={setNewSessionEnd}
                />
                {detailsError && <p style={{ fontSize: 14, color: SIGNAL_TEXT, margin: 0 }}>{detailsError}</p>}
              </div>
            </div>
          )}

          {resumeError && <LeftRuleNote tone={SIGNAL_TEXT}>{resumeError}</LeftRuleNote>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22, alignItems: 'center' }}>
            <button onClick={handleResume} disabled={resuming || cancelling} className="m-btn m-btn-primary">
              {resuming ? 'Resuming…' : 'Resume rollover'}
            </button>
            {canDiscard && (
              <button onClick={() => { setCancelError(null); setDiscardConfirmOpen(true) }} disabled={cancelling || resuming} className="m-btn m-btn-ghost">
                Discard and start over
              </button>
            )}
          </div>

          {discardConfirmOpen && (
            <DestructiveConfirmModal
              title="Discard this rollover attempt?"
              description="This run failed before creating the new term or touching any student, so nothing to discard except the failed attempt itself — your current term, students, and fees are untouched."
              rows={[
                { label: 'Last completed step', value: polledRun.step, emphasize: true },
              ]}
              note="You can start the rollover again from scratch afterward."
              error={cancelError}
              actions={[
                { label: 'Keep it', onClick: () => setDiscardConfirmOpen(false), variant: 'outline', disabled: cancelling },
                { label: cancelling ? 'Discarding…' : 'Discard', onClick: handleCancel, variant: 'danger', disabled: cancelling },
              ]}
            />
          )}
        </div>
      </div>
    )
  }

  if (previewError) {
    return (
      <div style={{ maxWidth: 880 }}>
        <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
          <h2 style={{ fontSize: 25, fontWeight: 800, margin: '0 0 6px', color: INK }}>Year end is not available yet</h2>
          <LeftRuleNote>{previewError}</LeftRuleNote>
        </div>
      </div>
    )
  }

  // ── LANDING: the App Shell canvas replica (the pre-run ledger IS the first
  //    screen), computed from real data with auto defaults, no input needed ──
  if (step === 'landing') {
    return (
      <div style={{ maxWidth: 880 }}>
        <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
          <h2 style={{ fontSize: 25, fontWeight: 800, margin: '0 0 6px', color: INK }}>
            Year end &mdash; roll {prevSessionLabel} into {newSessionLabel}
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: BODY, margin: '0 0 8px', maxWidth: '72ch' }}>
            The largest irreversible operation in the product. It promotes every class, graduates the leavers, carries
            outstanding balances, and opens a new academic session with its first term.
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, color: OCHRE, margin: '0 0 8px', maxWidth: '72ch' }}>
            Run this once, on the final term of the year while it is still active. The rollover closes that term itself, so do not close it beforehand. Everything below happens together and cannot be undone.
          </p>
        </div>

        <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 28, paddingTop: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: INK }}>What the rollover will do</h3>
          <p style={{ fontSize: 14, color: BODY, margin: '0 0 14px', maxWidth: '70ch' }}>
            Nothing has happened yet. This is what the button below will do, itemised, before you press it.
          </p>

          <LedgerRow
            what="Students promoted to the next class"
            val={summary.promote.toLocaleString('en-NG')}
            ink={summary.promote > 0 ? INK : DIM}
          />
          <LedgerRow
            what={exitClassLabel}
            val={summary.graduate.toLocaleString('en-NG')}
            ink={summary.graduate > 0 ? INK : DIM}
          />
          <LedgerRow
            what="Students repeating — held back manually"
            val={summary.repeat.toLocaleString('en-NG')}
            ink={summary.repeat > 0 ? INK : DIM}
          />
          <LedgerRow
            what={`Balances carried into ${firstTermName}`}
            val={showFinancials ? naira(balancePreview.carryAmount) : `${balancePreview.carryStudents.toLocaleString('en-NG')} students`}
            ink={(showFinancials ? balancePreview.carryAmount : balancePreview.carryStudents) > 0 ? OCHRE : DIM}
          />
          <LedgerRow
            what="New session created with its first term"
            val={newSessionLabel}
            ink={INK}
          />
          <LedgerRow what={feesRow.what} val={feesRow.val} ink={feesRow.ink} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22, alignItems: 'center' }}>
            <button onClick={() => setStep('details')} className="m-btn m-btn-danger">Run year-end rollover</button>
            <button onClick={handleExportList} className="m-btn m-btn-outline">Export this list first</button>
            <span style={{ fontSize: 13, color: OCHRE, fontWeight: 600 }}>Cannot be undone</span>
          </div>
        </div>
      </div>
    )
  }

  // ── AFTER THE BUTTON: the 5-step input + commit flow ──────────────────────
  return (
    <div style={{ maxWidth: 880 }}>
      {/* Compact header + the flow stepper */}
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px', color: INK }}>
          Year end &mdash; roll {prevSessionLabel} into {newSessionLabel}
        </h2>
        <p style={{ fontSize: 14, color: BODY, margin: '0 0 16px', maxWidth: '72ch' }}>
          Work through each step. Nothing changes until you type the session name and run it on the final step.
        </p>
        <StepStrip current={step} />
      </div>

      {/* 01 — New year details */}
      {step === 'details' && (
        <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 20, paddingTop: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: INK }}>New year details</h3>
          <p style={{ fontSize: 14, color: BODY, margin: '0 0 18px', maxWidth: '70ch' }}>
            Confirm the session to promote into. Pre-filled from {prevSessionLabel} &mdash; change the session, term, or dates if your calendar differs, or adopt one you prepared ahead of time in Academic structure.
          </p>
          <div className="space-y-4" style={{ maxWidth: 480 }}>
            <SessionSourceFields
              draftSessions={draftSessions}
              sessionSource={sessionSource} setSessionSource={setSessionSource}
              adoptSessionId={adoptSessionId} setAdoptSessionId={setAdoptSessionId}
              adoptCycleId={adoptCycleId} setAdoptCycleId={setAdoptCycleId}
              adoptedSession={adoptedSession}
              name={name} setName={setName}
              startDate={startDate} setStartDate={setStartDate}
              endDate={endDate} setEndDate={setEndDate}
              dueDate={dueDate} setDueDate={setDueDate}
              newSessionName={newSessionName} setNewSessionName={setNewSessionName}
              newSessionStart={newSessionStart} setNewSessionStart={setNewSessionStart}
              newSessionEnd={newSessionEnd} setNewSessionEnd={setNewSessionEnd}
            />
            {detailsError && <p style={{ fontSize: 14, color: SIGNAL_TEXT, margin: 0 }}>{detailsError}</p>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
            <button
              onClick={() => { if (validateDetails()) setStep('readiness') }}
              className="m-btn m-btn-primary"
            >
              Continue to readiness checks
            </button>
            <button onClick={() => setStep('landing')} className="m-btn m-btn-outline">Back to summary</button>
          </div>
        </div>
      )}

      {/* 02 — Readiness checks */}
      {step === 'readiness' && (
        <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 20, paddingTop: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: INK }}>Readiness checks</h3>
          <p style={{ fontSize: 14, color: BODY, margin: '0 0 16px', maxWidth: '72ch' }}>
            What the rollover found before you run it. Anything marked {' '}
            <span style={{ color: OCHRE, fontWeight: 600 }}>needs a look</span> can still proceed; a {' '}
            <span style={{ color: SIGNAL_TEXT, fontWeight: 600 }}>must fix</span> blocks the run until it is resolved.
          </p>

          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 620 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.1fr) minmax(0,2.2fr) minmax(120px,auto)', gap: 16, padding: '0 0 8px', borderBottom: `2px solid ${INK}` }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: DIM }}>CHECK</span>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: DIM }}>WHAT IT MEANS</span>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: DIM }}>STATUS</span>
              </div>
              {checks.map(c => {
                const accent = c.tone === 'hard' ? SIGNAL_TEXT : c.tone === 'warn' ? OCHRE : null
                const statusColor = c.tone === 'hard' ? SIGNAL_TEXT : c.tone === 'warn' ? OCHRE : c.tone === 'info' ? INK : BODY
                return (
                  <div
                    key={c.key}
                    style={{
                      borderTop: `1px solid ${RULE_SOFT}`,
                      borderLeft: accent ? `2px solid ${accent}` : 'none',
                      paddingLeft: accent ? 12 : 0,
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.1fr) minmax(0,2.2fr) minmax(120px,auto)', gap: 16, padding: '12px 0', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{c.title}</span>
                      <span style={{ fontSize: 14, color: BODY, lineHeight: 1.5 }}>{c.desc}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>{c.status}</span>
                        {c.action && (
                          <button onClick={() => router.push(c.action!.href)} className="m-btn m-btn-outline" style={{ fontSize: 12, padding: '4px 10px' }}>
                            {c.action.label}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {hardBlockers.length > 0 && (
            <LeftRuleNote tone={SIGNAL_TEXT}>
              Resolve {hardBlockers.length === 1 ? 'the blocker' : `${hardBlockers.length} blockers`} marked &ldquo;must fix&rdquo; above, then come back and continue.
            </LeftRuleNote>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
            <button
              onClick={() => setStep('promotions')}
              disabled={hardBlockers.length > 0}
              className="m-btn m-btn-primary"
            >
              Continue to promotion tree
            </button>
            <button onClick={() => setStep('details')} className="m-btn m-btn-outline">Back</button>
          </div>
        </div>
      )}

      {/* 03 — Promotion tree */}
      {step === 'promotions' && (
        <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 20, paddingTop: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: INK }}>Promotion tree</h3>
          <p style={{ fontSize: 14, color: BODY, margin: '0 0 6px', maxWidth: '72ch' }}>
            Each class moves to the next one up the ladder. A class with no next class is an exit point &mdash; its students
            graduate and leave. Select a class to review or override its students; only one class opens at a time.
          </p>
          <p style={{ fontSize: 14, color: BODY, margin: '0 0 6px', maxWidth: '72ch', fontVariantNumeric: 'tabular-nums' }}>
            {summary.promote} to promote &middot; {summary.repeat} repeating &middot; {summary.graduate} graduating
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 18px', color: overriddenTotal > 0 ? OCHRE : DIM, fontVariantNumeric: 'tabular-nums' }}>
            {overriddenTotal > 0
              ? `${overriddenTotal} student${overriddenTotal === 1 ? '' : 's'} changed from the class default`
              : 'No student changed from the class default'}
          </p>

          {groups.length === 0 && (
            <p style={{ fontSize: 14, color: BODY }}>No active students found to promote.</p>
          )}

          {/* The ladder: one row per class, expandable to its student list. */}
          {ladder.length > 0 && (
            <div style={{ borderTop: `2px solid ${INK}` }}>
              {ladder.map(l => {
                const open = expandedClassId === l.classId
                const group = groups.find(g => g.classId === l.classId)
                return (
                  <div
                    key={l.classId}
                    style={{
                      borderBottom: `1px solid ${RULE_SOFT}`,
                      borderLeft: `2px solid ${open ? INK : 'transparent'}`,
                      paddingLeft: 12,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedClassId(open ? null : l.classId)}
                      aria-expanded={open}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        padding: '12px 0',
                        cursor: 'pointer',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1fr) auto',
                        gap: 16,
                        alignItems: 'center',
                        color: 'inherit',
                      }}
                    >
                      <span>
                        <span style={{ fontSize: 14 }}>
                          <span style={{ color: INK, fontWeight: 600 }}>{l.className}</span>
                          <span style={{ color: DIM, fontVariantNumeric: 'tabular-nums' }}> ({l.count})</span>
                          <span style={{ color: DIM }}> {'→'} </span>
                          <span style={{ color: l.isExit ? OCHRE : INK, fontWeight: 600 }}>{l.toLabel}</span>
                        </span>
                        <span style={{ display: 'block', fontSize: 13, color: BODY, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                          {l.promote} promote &middot; {l.repeat} repeat &middot; {l.graduate} graduate
                          {l.overrides > 0 && (
                            <span style={{ color: OCHRE, fontWeight: 600 }}> &middot; {l.overrides} changed</span>
                          )}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        style={{
                          fontSize: 20,
                          lineHeight: 1,
                          color: DIM,
                          display: 'inline-block',
                          transform: open ? 'rotate(90deg)' : 'none',
                          transition: 'transform 120ms',
                        }}
                      >
                        {'›'}
                      </span>
                    </button>

                    {open && group && (
                      <div style={{ paddingBottom: 16 }}>
                        <div style={{ border: `1px solid ${RULE_SOFT}`, overflowX: 'auto' }}>
                          <table className="m-table min-w-[560px]">
                            <thead>
                              <tr>
                                <th className="text-left">Student</th>
                                <th className="text-left">Action</th>
                                <th className="text-left">Target class</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.students.map(row => {
                                const decision = decisions[row.studentId]
                                return (
                                  <tr key={row.studentId}>
                                    <td style={{ color: INK }}>
                                      {row.studentName} <span style={{ color: DIM }}>({row.admissionNumber})</span>
                                      {row.suggestedAction === 'graduate' && (
                                        <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: OCHRE }}>exit point</span>
                                      )}
                                    </td>
                                    <td>
                                      <select
                                        value={decision.action}
                                        onChange={(e) => {
                                          const newAction = e.target.value as RowDecision['action']
                                          // Keep targetClassId honest for the row's own display/state,
                                          // not just the outgoing payload (buildDecisionList strips it
                                          // for non-'promote' anyway) — 'repeat' truly means "stays in
                                          // currentClassId", not whatever class 'promote' last suggested.
                                          let targetClassId = decision.targetClassId
                                          if (newAction === 'promote') targetClassId = row.suggestedTargetClassId || ''
                                          else if (newAction === 'repeat') targetClassId = row.currentClassId
                                          setDecision(row.studentId, { action: newAction, targetClassId })
                                        }}
                                        className="m-select w-auto py-1"
                                      >
                                        <option value="promote">Promote</option>
                                        <option value="repeat">Repeat class</option>
                                        <option value="graduate">Graduate / exit</option>
                                      </select>
                                    </td>
                                    <td>
                                      {decision.action === 'promote' ? (
                                        <select
                                          value={decision.targetClassId}
                                          onChange={(e) => setDecision(row.studentId, { targetClassId: e.target.value })}
                                          className="m-select w-auto py-1"
                                        >
                                          <option value="">- Select class -</option>
                                          {classes.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                          ))}
                                        </select>
                                      ) : decision.action === 'repeat' ? (
                                        <span style={{ color: BODY }}>{row.currentClassName}</span>
                                      ) : (
                                        <span style={{ color: DIM }}>&mdash;</span>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
            <button onClick={() => setStep('balances')} className="m-btn m-btn-primary">Continue to balances</button>
            <button onClick={() => setStep('readiness')} className="m-btn m-btn-outline">Back</button>
          </div>
        </div>
      )}

      {/* 04 — Balances */}
      {step === 'balances' && (
        <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 20, paddingTop: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: INK }}>Balances</h3>
          <p style={{ fontSize: 14, color: BODY, margin: '0 0 14px', maxWidth: '72ch' }}>
            What happens to money still owed. A continuing student&apos;s balance rides forward onto their first invoice in the
            new term. A leaver&apos;s balance does not &mdash; it stays on their final, now-closed invoice. Export the list and
            pursue leaver arrears before the students are archived.
          </p>

          <div>
            <LedgerRow
              what={`Continuing students whose balance carries into ${firstTermName}`}
              val={balancePreview.carryStudents.toLocaleString('en-NG')}
              ink={balancePreview.carryStudents > 0 ? OCHRE : DIM}
            />
            {showFinancials && (
              <LedgerRow
                what={`Money carried into ${firstTermName}`}
                val={naira(balancePreview.carryAmount)}
                ink={balancePreview.carryAmount > 0 ? OCHRE : DIM}
                sub="Applied to each student's first-term invoice when it is generated after the rollover."
              />
            )}
            <LedgerRow
              what="Graduating students who still owe — carried nowhere"
              val={balancePreview.leaverStudents > 0
                ? (showFinancials ? `${balancePreview.leaverStudents.toLocaleString('en-NG')} · ${naira(balancePreview.leaverAmount)}` : balancePreview.leaverStudents.toLocaleString('en-NG'))
                : '0'}
              ink={balancePreview.leaverStudents > 0 ? OCHRE : DIM}
              sub={balancePreview.leaverStudents > 0
                ? 'Their balance is not written off, but it will not appear on any new invoice once they are archived. Export and collect or clear it first.'
                : 'No graduating student has an outstanding balance.'}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20, alignItems: 'center' }}>
            <button onClick={handleExportList} className="m-btn m-btn-outline">Export leaver and carry-forward list</button>
            <span style={{ fontSize: 13, color: DIM }}>Every student, their action, and their balance disposition as a CSV.</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
            <button onClick={() => setStep('confirm')} className="m-btn m-btn-primary">Continue to commit</button>
            <button onClick={() => setStep('promotions')} className="m-btn m-btn-outline">Back</button>
          </div>
        </div>
      )}

      {/* 05 — Commit (irreversible) */}
      {step === 'confirm' && (
        <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 20, paddingTop: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: INK }}>Commit</h3>
          <p style={{ fontSize: 14, color: BODY, margin: '0 0 14px', maxWidth: '70ch' }}>
            The final summary of everything the run will do, in one transaction. Nothing has happened yet. Type the session name to run it.
          </p>

          <div>
            <LedgerRow
              what="Students promoted to the next class"
              val={summary.promote.toLocaleString('en-NG')}
              ink={summary.promote > 0 ? INK : DIM}
            />
            <LedgerRow
              what="Students graduated and archived"
              val={summary.graduate.toLocaleString('en-NG')}
              ink={summary.graduate > 0 ? INK : DIM}
            />
            <LedgerRow
              what="Students repeating — held back manually"
              val={summary.repeat.toLocaleString('en-NG')}
              ink={summary.repeat > 0 ? INK : DIM}
            />
            <LedgerRow
              what={`Balances carried into ${firstTermName}`}
              val={showFinancials ? naira(balancePreview.carryAmount) : `${balancePreview.carryStudents.toLocaleString('en-NG')} students`}
              ink={(showFinancials ? balancePreview.carryAmount : balancePreview.carryStudents) > 0 ? OCHRE : DIM}
            />
            {balancePreview.leaverStudents > 0 && (
              <LedgerRow
                what="Graduating students who still owe — carried nowhere"
                val={showFinancials
                  ? `${balancePreview.leaverStudents.toLocaleString('en-NG')} · ${naira(balancePreview.leaverAmount)}`
                  : balancePreview.leaverStudents.toLocaleString('en-NG')}
                ink={OCHRE}
              />
            )}
            <LedgerRow what="New session opened" val={newSessionLabel} ink={INK} />
            <LedgerRow
              what={sessionSource === 'adopt' && adoptCycleId ? 'First term activated' : 'First term created and activated'}
              val={firstTermName}
              ink={INK}
            />
            <LedgerRow what={feesRow.what} val={feesRow.val} ink={feesRow.ink} />
          </div>

          <div style={{ marginTop: 24, maxWidth: 480 }}>
            <label className="m-label">
              Type <span style={{ color: INK, fontWeight: 700 }}>{expectedConfirmName || 'the session name'}</span> to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={expectedConfirmName}
              className="m-input"
            />
          </div>

          {submitError && <LeftRuleNote tone={SIGNAL_TEXT}>{submitError}</LeftRuleNote>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22, alignItems: 'center' }}>
            <button
              onClick={handleSubmit}
              disabled={submitting || confirmText.trim() !== expectedConfirmName.trim()}
              className="m-btn m-btn-danger"
            >
              {submitting ? 'Rolling over…' : 'Run year-end rollover'}
            </button>
            <button onClick={() => setStep('balances')} disabled={submitting} className="m-btn m-btn-outline">Back</button>
            <span style={{ fontSize: 13, color: OCHRE, fontWeight: 600 }}>Cannot be undone</span>
          </div>
        </div>
      )}
    </div>
  )
}

function SessionSourceFields({
  draftSessions,
  sessionSource, setSessionSource,
  adoptSessionId, setAdoptSessionId,
  adoptCycleId, setAdoptCycleId,
  adoptedSession,
  name, setName, startDate, setStartDate, endDate, setEndDate, dueDate, setDueDate,
  newSessionName, setNewSessionName, newSessionStart, setNewSessionStart, newSessionEnd, setNewSessionEnd,
}: {
  draftSessions: DraftSession[]
  sessionSource: 'new' | 'adopt'; setSessionSource: (v: 'new' | 'adopt') => void
  adoptSessionId: string; setAdoptSessionId: (v: string) => void
  adoptCycleId: string; setAdoptCycleId: (v: string) => void
  adoptedSession: DraftSession | undefined
  name: string; setName: (v: string) => void
  startDate: string; setStartDate: (v: string) => void
  endDate: string; setEndDate: (v: string) => void
  dueDate: string; setDueDate: (v: string) => void
  newSessionName: string; setNewSessionName: (v: string) => void
  newSessionStart: string; setNewSessionStart: (v: string) => void
  newSessionEnd: string; setNewSessionEnd: (v: string) => void
}) {
  return (
    <>
      {draftSessions.length > 0 && (
        <div>
          <label className="m-label">Which session are you rolling into?</label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 p-2 cursor-pointer hover:bg-[var(--color-surface)]">
              <input
                type="radio"
                checked={sessionSource === 'adopt'}
                onChange={() => setSessionSource('adopt')}
                className="mt-0.5 accent-[var(--color-ink)]"
              />
              <div className="flex-1">
                <span className="text-sm text-[var(--color-ink)]">Use a session prepared ahead of time</span>
                {sessionSource === 'adopt' && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={adoptSessionId}
                      onChange={(e) => { setAdoptSessionId(e.target.value); setAdoptCycleId('') }}
                      className="m-select"
                    >
                      {draftSessions.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    {adoptedSession && adoptedSession.terms.length > 0 && (
                      <select
                        value={adoptCycleId}
                        onChange={(e) => setAdoptCycleId(e.target.value)}
                        className="m-select"
                      >
                        <option value="">- Create a new term in this session -</option>
                        {adoptedSession.terms.map(t => (
                          <option key={t.id} value={t.id}>{t.name} (use this prepared term)</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            </label>
            <label className="flex items-start gap-2 p-2 cursor-pointer hover:bg-[var(--color-surface)]">
              <input
                type="radio"
                checked={sessionSource === 'new'}
                onChange={() => setSessionSource('new')}
                className="mt-0.5 accent-[var(--color-ink)]"
              />
              <span className="text-sm text-[var(--color-ink)]">Create a brand new session</span>
            </label>
          </div>
        </div>
      )}

      {sessionSource === 'adopt' && adoptCycleId ? (
        <p className="text-sm text-[var(--color-neutral-800)]">
          Rolling into <span className="font-medium text-[var(--color-ink)]">{adoptedSession?.terms.find(t => t.id === adoptCycleId)?.name}</span> — its fee items are already set up.
        </p>
      ) : (
        <>
          {sessionSource === 'new' && (
            <>
              <div>
                <label className="m-label">New session name *</label>
                <input
                  type="text"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="e.g. 2027/2028"
                  className="m-input"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="m-label">Session start *</label>
                  <input
                    type="date"
                    value={newSessionStart}
                    onChange={(e) => setNewSessionStart(e.target.value)}
                    className="m-input"
                  />
                </div>
                <div>
                  <label className="m-label">Session end *</label>
                  <input
                    type="date"
                    value={newSessionEnd}
                    onChange={(e) => setNewSessionEnd(e.target.value)}
                    className="m-input"
                  />
                </div>
              </div>
            </>
          )}
          <div>
            <label className="m-label">First term name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. First Term 2027/2028"
              className="m-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="m-label">Term start *</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="m-input"
              />
            </div>
            <div>
              <label className="m-label">Term end *</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="m-input"
              />
            </div>
          </div>
          <div>
            <label className="m-label">Term due date *</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="m-input"
            />
          </div>
        </>
      )}
    </>
  )
}
