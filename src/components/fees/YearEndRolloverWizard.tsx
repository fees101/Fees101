'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { startYearEndRollover, resumeYearEndRollover, cancelYearEndRollover } from '@/app/(app)/fees/cycles/actions'
import { PromotionPreviewGroup, PromotionDecision } from '@/lib/yearEnd/promotion'
import { DraftSession } from '@/app/(app)/fees/year-end/actions'

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
}

type RowDecision = { action: 'promote' | 'repeat' | 'graduate'; targetClassId: string }

type WizardStep = 'details' | 'promotions' | 'confirm'

type RolloverResult = {
  toCycleId: string | null
  exitInvoiceWarnings: { studentId: string; invoiceId: string }[]
  regeneratedCount: number
  regenerateErrors: { studentId: string; error: string }[]
  unmatchedAdjustments: { studentId: string; feeItemName: string }[]
  staleDraftsClosed: number
  staleDraftWarnings: { sessionId: string; sessionName: string }[]
}

const STEP_LABELS: { key: WizardStep; label: string }[] = [
  { key: 'details', label: 'New year details' },
  { key: 'promotions', label: 'Promotion review' },
  { key: 'confirm', label: 'Confirm' },
]

export default function YearEndRolloverWizard({ activeRun, groups, classes, previewError, draftSessions }: Props) {
  const router = useRouter()

  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)

  const [step, setStep] = useState<WizardStep>('details')

  // 'new' creates a fresh session+term (default when nothing's been prepared ahead of time);
  // 'adopt' rolls into a session that was already drafted (e.g. via Academic Structure → Sessions).
  const [sessionSource, setSessionSource] = useState<'new' | 'adopt'>(draftSessions.length > 0 ? 'adopt' : 'new')
  const [adoptSessionId, setAdoptSessionId] = useState(draftSessions[0]?.id || '')
  const [adoptCycleId, setAdoptCycleId] = useState('')

  const adoptedSession = useMemo(() => draftSessions.find(s => s.id === adoptSessionId), [draftSessions, adoptSessionId])
  const adoptingExistingTerm = sessionSource === 'adopt' && !!adoptCycleId

  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [newSessionName, setNewSessionName] = useState('')
  const [newSessionStart, setNewSessionStart] = useState('')
  const [newSessionEnd, setNewSessionEnd] = useState('')
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
  // rolling into a prepared session, otherwise the new session name they typed.
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
    return Object.entries(decisions).map(([studentId, d]) => ({
      studentId,
      action: d.action,
      targetClassId: d.action !== 'graduate' ? d.targetClassId || undefined : undefined,
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
    if (!activeRun) return
    setResuming(true)
    setResumeError(null)

    const needsNewTerm = activeRun.step === 'started'
    if (needsNewTerm && !validateDetails()) {
      setResuming(false)
      return
    }

    const resumeResult = await resumeYearEndRollover(
      activeRun.id,
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

  async function handleCancel() {
    if (!activeRun) return
    setCancelling(true)
    setCancelError(null)
    const cancelResult = await cancelYearEndRollover(activeRun.id)
    if ('error' in cancelResult) {
      setCancelError(cancelResult.error)
      setCancelling(false)
      return
    }
    router.refresh()
  }

  if (result) {
    const hasWarnings = result.exitInvoiceWarnings.length > 0 || result.regenerateErrors.length > 0 || result.unmatchedAdjustments.length > 0 || result.staleDraftWarnings.length > 0
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <div>
            <h3 className="text-base font-semibold text-navy">Rollover complete</h3>
            <p className="text-sm text-gray-500 mt-1">
              Students promoted and the new term is active. Invoices have <strong>not</strong> been generated yet —
              confirm fee items for the new term, then generate invoices from the term page when ready to send to parents.
            </p>
            {result.regeneratedCount > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {result.regeneratedCount} previously previewed invoice{result.regeneratedCount === 1 ? '' : 's'} updated to reflect promoted students' new classes.
              </p>
            )}
            {result.staleDraftsClosed > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {result.staleDraftsClosed} old, unused draft session{result.staleDraftsClosed === 1 ? '' : 's'} left over from before this rollover {result.staleDraftsClosed === 1 ? 'was' : 'were'} closed so they can't be mistakenly activated later.
              </p>
            )}
          </div>
        </div>

        {result.staleDraftWarnings.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            <p className="font-medium">
              {result.staleDraftWarnings.length} old draft session{result.staleDraftWarnings.length === 1 ? '' : 's'} from before this rollover already {result.staleDraftWarnings.length === 1 ? 'has' : 'have'} invoices on it and were left alone rather than closed automatically — review and close manually from Academic Structure if no longer needed: {result.staleDraftWarnings.map(w => w.sessionName).join(', ')}.
            </p>
          </div>
        )}

        {result.exitInvoiceWarnings.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            <p className="font-medium">{result.exitInvoiceWarnings.length} exiting student{result.exitInvoiceWarnings.length === 1 ? '' : 's'} had a preview invoice with payment or credit already applied — left as-is for manual review rather than cancelled automatically.</p>
          </div>
        )}

        {result.regenerateErrors.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            <p className="font-medium">{result.regenerateErrors.length} invoice{result.regenerateErrors.length === 1 ? '' : 's'} couldn't be auto-updated and may need a manual look.</p>
          </div>
        )}

        {result.unmatchedAdjustments.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            <p className="font-medium">{result.unmatchedAdjustments.length} fee opt-in/exemption{result.unmatchedAdjustments.length === 1 ? '' : 's'} couldn't be matched to a fee item in the new term and were not carried forward.</p>
          </div>
        )}

        {!hasWarnings && (
          <p className="text-sm text-gray-500">No issues found — everything carried forward cleanly.</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => router.push('/fees/cycles')}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
          >
            Go to cycles
          </button>
          <button
            onClick={() => router.push(result.toCycleId ? `/fees/cycles/${result.toCycleId}` : '/fees/cycles')}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
          >
            Review new term & generate invoices
          </button>
        </div>
      </div>
    )
  }

  if (activeRun) {
    const needsNewTerm = activeRun.step === 'started'
    const canDiscard = activeRun.status === 'failed' && activeRun.step === 'started' && !activeRun.to_cycle_id
    return (
      <div className="bg-white rounded-xl border border-amber-200 p-5">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </span>
          <div>
            <h3 className="text-base font-semibold text-navy">
              {activeRun.status === 'failed' ? 'Rollover failed mid-run' : 'Rollover already in progress'}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Last completed step: <span className="font-medium text-navy">{activeRun.step}</span>
              {activeRun.error_detail && (
                <> — <span className="text-red-600">{activeRun.error_detail}</span></>
              )}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Resuming will pick up exactly where it left off — no student already promoted will be promoted again.
            </p>
          </div>
        </div>

        {needsNewTerm && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <p className="text-sm text-navy font-medium">
              The new term wasn't created yet — re-enter its details to continue.
            </p>
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
            {detailsError && <p className="text-sm text-red-600">{detailsError}</p>}
          </div>
        )}

        {resumeError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {resumeError}
          </div>
        )}

        {cancelError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {cancelError}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {canDiscard && (
            <button
              onClick={handleCancel}
              disabled={cancelling || resuming}
              className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
            >
              {cancelling ? 'Discarding...' : 'Discard & start over'}
            </button>
          )}
          <button
            onClick={handleResume}
            disabled={resuming || cancelling}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
          >
            {resuming ? 'Resuming...' : 'Resume rollover'}
          </button>
        </div>
      </div>
    )
  }

  if (previewError) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        {previewError}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 p-5 border-b border-gray-100">
        {STEP_LABELS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
              step === s.key ? 'bg-mint text-navy' : STEP_LABELS.findIndex(x => x.key === step) > i ? 'bg-mint/30 text-navy' : 'bg-gray-100 text-gray-400'
            }`}>
              {i + 1}
            </span>
            <span className={`text-sm ${step === s.key ? 'text-navy font-medium' : 'text-gray-400'}`}>{s.label}</span>
            {i < STEP_LABELS.length - 1 && <span className="w-8 h-px bg-gray-200 mx-1" />}
          </div>
        ))}
      </div>

      <div className="p-5">
        {step === 'details' && (
          <div className="space-y-4 max-w-md">
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
            {detailsError && <p className="text-sm text-red-600">{detailsError}</p>}
          </div>
        )}

        {step === 'promotions' && (
          <div className="space-y-6">
            {groups.length === 0 && (
              <p className="text-sm text-gray-500">No active students found to promote.</p>
            )}
            {groups.map(group => (
              <div key={group.classId}>
                <h4 className="text-sm font-semibold text-navy mb-2">{group.className} <span className="text-gray-400 font-normal">({group.students.length})</span></h4>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Student</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Action</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Target class</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {group.students.map(row => {
                        const decision = decisions[row.studentId]
                        return (
                          <tr key={row.studentId}>
                            <td className="px-3 py-2 text-navy">
                              {row.studentName} <span className="text-gray-400">({row.admissionNumber})</span>
                              {row.suggestedAction === 'graduate' && (
                                <span className="ml-2 inline-block px-1.5 py-0.5 text-xs bg-amber-50 text-amber-700 rounded">exit point</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={decision.action}
                                onChange={(e) => setDecision(row.studentId, {
                                  action: e.target.value as RowDecision['action'],
                                  targetClassId: e.target.value === 'promote' ? (row.suggestedTargetClassId || '') : decision.targetClassId,
                                })}
                                className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                              >
                                <option value="promote">Promote</option>
                                <option value="repeat">Repeat class</option>
                                <option value="graduate">Graduate / exit</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              {decision.action === 'promote' ? (
                                <select
                                  value={decision.targetClassId}
                                  onChange={(e) => setDecision(row.studentId, { targetClassId: e.target.value })}
                                  className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                                >
                                  <option value="">— Select class —</option>
                                  {classes.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              ) : decision.action === 'repeat' ? (
                                <span className="text-gray-500">{row.currentClassName}</span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4 max-w-md">
            <div className="p-4 bg-gray-50 rounded-lg space-y-1 text-sm">
              <p className="text-navy font-medium">Summary</p>
              <p className="text-gray-600">{summary.promote} promoted, {summary.repeat} repeat, {summary.graduate} graduate / exit</p>
              {sessionSource === 'adopt' ? (
                <>
                  <p className="text-gray-600">Session: {adoptedSession?.name} (prepared earlier)</p>
                  <p className="text-gray-600">
                    Term: {adoptingExistingTerm
                      ? adoptedSession?.terms.find(t => t.id === adoptCycleId)?.name
                      : `${name} (${startDate} – ${endDate}), due ${dueDate}`}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-gray-600">New session: {newSessionName} ({newSessionStart} – {newSessionEnd})</p>
                  <p className="text-gray-600">New term: {name} ({startDate} – {endDate}), due {dueDate}</p>
                </>
              )}
            </div>
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-2">
              <p className="text-sm text-red-700 font-medium">This cannot be undone.</p>
              <p className="text-sm text-red-700">
                The current term will close and students will be promoted into their next class.
                Invoices are <strong>not</strong> generated automatically — you'll confirm the new term's fees and generate them yourself afterwards.
                Type the session name below to confirm.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={expectedConfirmName}
                className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>
            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {submitError}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-100 flex items-center justify-between">
        <button
          onClick={() => {
            if (step === 'promotions') setStep('details')
            else if (step === 'confirm') setStep('promotions')
            else router.push('/fees/cycles')
          }}
          disabled={submitting}
          className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
        >
          {step === 'details' ? 'Cancel' : 'Back'}
        </button>

        {step !== 'confirm' ? (
          <button
            onClick={() => {
              if (step === 'details') {
                if (validateDetails()) setStep('promotions')
              } else {
                setStep('confirm')
              }
            }}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting || confirmText.trim() !== expectedConfirmName.trim()}
            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Rolling over...' : 'Start year-end rollover'}
          </button>
        )}
      </div>
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
          <label className="block text-xs text-gray-500 mb-2">Which session are you rolling into?</label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                checked={sessionSource === 'adopt'}
                onChange={() => setSessionSource('adopt')}
                className="mt-0.5 text-mint"
              />
              <div className="flex-1">
                <span className="text-sm text-navy">Use a session prepared ahead of time</span>
                {sessionSource === 'adopt' && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={adoptSessionId}
                      onChange={(e) => { setAdoptSessionId(e.target.value); setAdoptCycleId('') }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                    >
                      {draftSessions.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    {adoptedSession && adoptedSession.terms.length > 0 && (
                      <select
                        value={adoptCycleId}
                        onChange={(e) => setAdoptCycleId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                      >
                        <option value="">— Create a new term in this session —</option>
                        {adoptedSession.terms.map(t => (
                          <option key={t.id} value={t.id}>{t.name} (use this prepared term)</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            </label>
            <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                checked={sessionSource === 'new'}
                onChange={() => setSessionSource('new')}
                className="mt-0.5 text-mint"
              />
              <span className="text-sm text-navy">Create a brand new session</span>
            </label>
          </div>
        </div>
      )}

      {sessionSource === 'adopt' && adoptCycleId ? (
        <p className="text-sm text-gray-500">
          Rolling into <span className="font-medium text-navy">{adoptedSession?.terms.find(t => t.id === adoptCycleId)?.name}</span> — its fee items are already set up.
        </p>
      ) : (
        <>
          {sessionSource === 'new' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">New session name *</label>
                <input
                  type="text"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="e.g. 2027/2028"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Session start *</label>
                  <input
                    type="date"
                    value={newSessionStart}
                    onChange={(e) => setNewSessionStart(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Session end *</label>
                  <input
                    type="date"
                    value={newSessionEnd}
                    onChange={(e) => setNewSessionEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                  />
                </div>
              </div>
            </>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">First term name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. First Term 2027/2028"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Term start *</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Term end *</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Term due date *</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            />
          </div>
        </>
      )}
    </>
  )
}
