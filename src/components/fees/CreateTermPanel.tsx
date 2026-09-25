'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { CycleRow, SessionRow } from '@/lib/queries/fees'
import { createTerm, updateTerm } from '@/app/(app)/fees/cycles/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'

// Paper-ground palette, matching FeeFormPanel's option-card treatment.
const INK = '#201e1d'
const HINT = '#605d5d'
const RULE_SOFT = '#d7d3d3'

// 14px square selection mark, ink border, filled with an inset white ring when
// on — the App Shell .mk, shared with FeeFormPanel/EditFeeGroupPanel.
function Mark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        marginTop: 2,
        border: `2px solid ${INK}`,
        background: on ? INK : 'transparent',
        boxShadow: on ? 'inset 0 0 0 2px #fff' : 'none',
        display: 'block',
      }}
    />
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, letterSpacing: '0.1em', color: INK, fontWeight: 600, textTransform: 'uppercase', margin: '0 0 6px' }}>
      {children}
    </p>
  )
}

// A bordered radio/checkbox row inside a 2px-ink box (the App Shell .opt) —
// same component as FeeFormPanel's, so "Add a fee" and "Create term" read as
// the same design language. `children` renders inline below the hint, only
// while the row is selected — used for the session picker's embedded select
// and the new-session fields.
function OptRow({
  on, onClick, title, hint, last = false, children,
}: { on: boolean, onClick: () => void, title: string, hint?: string, last?: boolean, children?: React.ReactNode }) {
  return (
    <div
      style={{
        borderBottom: last ? 'none' : `1px solid ${RULE_SOFT}`,
        background: on ? '#eae7e7' : 'transparent',
      }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          width: '100%',
          textAlign: 'left',
          padding: '11px 12px',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <Mark on={on} />
        <span style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 13, color: INK, fontWeight: 600 }}>{title}</span>
          {hint && <span style={{ display: 'block', fontSize: 12, color: HINT, marginTop: 2 }}>{hint}</span>}
        </span>
      </button>
      {on && children && <div style={{ padding: '0 12px 12px 36px' }}>{children}</div>}
    </div>
  )
}

interface Props {
  mode: 'create' | 'edit'
  cycles: CycleRow[]
  sessions: SessionRow[]
  editingCycle?: CycleRow
  forceNewSession?: boolean
  onClose: () => void
  onSuccess: (carryForwardSummary?: {
    closedTermName: string | null
    invoicesUpdated: number
    invoicesNeedingResend: number
    studentsWithCarryForward: number
    totalCarryForward: number
    jobId: string | null
  } | null, unmatchedAdjustments?: { studentId: string; feeItemName: string }[]) => void
}

export default function CreateTermPanel({ mode, cycles, sessions, editingCycle, forceNewSession, onClose, onSuccess }: Props) {
  const isEdit = mode === 'edit'
  const canRunYearEnd = useCan('run-year-end')

  // A closed session shouldn't be offered for new terms — draft sessions are, so a term
  // (with fee items) can be prepared ahead of time under a session that isn't current yet.
  // If we're editing a term whose session was closed after the fact, keep that one session
  // selectable so the form doesn't break; it just won't be swappable for another closed one.
  const selectableSessions = useMemo(() => {
    const usable = sessions.filter(s => s.status === 'active' || s.status === 'draft')
    if (isEdit && editingCycle?.sessionId && !usable.some(s => s.id === editingCycle.sessionId)) {
      const current = sessions.find(s => s.id === editingCycle.sessionId)
      if (current) return [...usable, current]
    }
    return usable
  }, [sessions, isEdit, editingCycle])

  const [name, setName] = useState(editingCycle?.name || '')
  const [startDate, setStartDate] = useState(editingCycle?.startDate || '')
  const [endDate, setEndDate] = useState(editingCycle?.endDate || '')
  const [dueDate, setDueDate] = useState(editingCycle?.dueDate || '')

  const [sessionMode, setSessionMode] = useState<'existing' | 'new' | 'none'>(() => {
    if (isEdit) return editingCycle?.sessionId ? 'existing' : 'none'
    if (forceNewSession) return 'new'
    if (selectableSessions.length > 0) return 'existing'
    return 'new'
  })
  const [sessionId, setSessionId] = useState<string>(
    editingCycle?.sessionId || (isEdit ? '' : (selectableSessions[0]?.id ?? ''))
  )
  const [newSessionName, setNewSessionName] = useState('')
  const [newSessionStart, setNewSessionStart] = useState('')
  const [newSessionEnd, setNewSessionEnd] = useState('')

  const [rollForwardFromId, setRollForwardFromId] = useState<string>('')
  const [activateImmediately, setActivateImmediately] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSession = sessionMode === 'existing'
    ? selectableSessions.find(s => s.id === sessionId)
    : undefined
  const activationBlockedByDraftSession = selectedSession?.status === 'draft'

  const sortedCycles = useMemo(() => {
    return [...cycles].sort((a, b) => b.startDate.localeCompare(a.startDate))
  }, [cycles])

  async function handleSubmit() {
    setError(null)
    if (!name.trim()) {
      setError('Term name is required')
      return
    }
    if (!startDate || !endDate) {
      setError('Start and end dates are required')
      return
    }
    if (!dueDate) {
      setError('Due date is required')
      return
    }
    if (!isEdit && sessionMode === 'new' && !newSessionName.trim()) {
      setError('Session name is required (or choose an existing session / "No session")')
      return
    }

    setSaving(true)

    let result: Awaited<ReturnType<typeof updateTerm>> | Awaited<ReturnType<typeof createTerm>>
    if (isEdit && editingCycle) {
      result = await updateTerm(editingCycle.id, {
        name,
        startDate,
        endDate,
        dueDate,
      })
    } else {
      result = await createTerm({
        name,
        startDate,
        endDate,
        dueDate,
        sessionId: sessionMode === 'existing' ? sessionId : null,
        newSessionName: sessionMode === 'new' ? newSessionName : undefined,
        newSessionStart: sessionMode === 'new' ? newSessionStart : undefined,
        newSessionEnd: sessionMode === 'new' ? newSessionEnd : undefined,
        rollForwardFromCycleId: rollForwardFromId || null,
        activateImmediately: activationBlockedByDraftSession ? false : activateImmediately,
      })
    }

    if ('error' in result) {
      setError(result.error)
      setSaving(false)
      return
    }
    if ('summary' in result) {
      onSuccess(result.summary, result.unmatchedAdjustments)
    } else {
      onSuccess(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex m-anim-fade">
      <div
        className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
        onClick={onClose}
      />

      {/* Same shell as FeeFormPanel/AddStudentModal: 420px, single p-[22px]
          scroll (header, fields and footer all scroll together). */}
      <aside
        style={{ width: '420px', maxWidth: '100%' }}
        className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">
            {isEdit ? 'Edit term' : 'Create new term'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
          >
            Close
          </button>
        </div>
        <p className="text-[13px] leading-relaxed mb-5 text-[var(--color-neutral-700)]">
          {isEdit
            ? "Change the term's name or dates."
            : 'Name it, set its dates, choose a session, and optionally roll fees forward.'}
        </p>

        <div className="space-y-4" style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 16 }}>

        <div>
          <label className="m-label">Term name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Second Term 2026/2027"
            className="m-input"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="m-label">Start date *</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="m-input"
            />
          </div>
          <div>
            <label className="m-label">End date *</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="m-input"
            />
          </div>
        </div>

        <div>
          <label className="m-label">Due date *</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="m-input"
          />
          <p className="text-xs text-[var(--color-neutral-700)] mt-1">When parents should pay by</p>
        </div>

        <div>
          {isEdit ? (
            <>
              <label className="m-label">Session</label>
              <div className="p-3 bg-[var(--color-surface)] text-sm text-[var(--color-neutral-700)]">
                {editingCycle?.sessionId
                  ? <>{selectableSessions.find(s => s.id === editingCycle.sessionId)?.name || 'Unknown session'} <span className="text-xs text-[var(--color-neutral-500)]">- fixed at creation, cannot be changed</span></>
                  : <>No session <span className="text-xs text-[var(--color-neutral-500)]">- fixed at creation, cannot be changed</span></>
                }
              </div>
            </>
          ) : (
            <>
              <SectionLabel>Session</SectionLabel>
              <div style={{ border: `2px solid ${INK}`, background: '#fff' }}>
                {selectableSessions.length > 0 && (
                  <OptRow
                    on={sessionMode === 'existing'}
                    onClick={() => setSessionMode('existing')}
                    title="Existing session"
                  >
                    <select
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                      className="m-select"
                    >
                      {selectableSessions.map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.status === 'closed' ? ' (closed)' : s.status === 'draft' ? ' (draft)' : ''}</option>
                      ))}
                    </select>
                  </OptRow>
                )}
                {(forceNewSession || selectableSessions.length === 0) && (
                  <OptRow
                    on={sessionMode === 'new'}
                    onClick={() => setSessionMode('new')}
                    title="New session"
                  >
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={newSessionName}
                        onChange={(e) => setNewSessionName(e.target.value)}
                        placeholder="e.g. 2027/2028"
                        className="m-input"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={newSessionStart}
                          onChange={(e) => setNewSessionStart(e.target.value)}
                          placeholder="Start"
                          className="m-input"
                        />
                        <input
                          type="date"
                          value={newSessionEnd}
                          onChange={(e) => setNewSessionEnd(e.target.value)}
                          placeholder="End"
                          className="m-input"
                        />
                      </div>
                    </div>
                  </OptRow>
                )}
                <OptRow
                  on={sessionMode === 'none'}
                  onClick={() => setSessionMode('none')}
                  title="No session"
                  hint="Standalone term, not part of an academic year"
                  last
                />
              </div>
            </>
          )}
        </div>

        {!isEdit && activationBlockedByDraftSession && selectedSession && (
          <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]">
            {selectedSession.name} isn&apos;t the active session yet. A term created here won&apos;t move any students up a class
            {canRunYearEnd ? (
              <>
                {' '}— when you&apos;re ready to make this the live academic year, use{' '}
                <Link href="/fees/year-end" className="underline hover:text-[var(--color-ink)]">
                  Year-End Rollover
                </Link>{' '}
                instead.
              </>
            ) : (
              <> — when you&apos;re ready to make this the live academic year, use Year-End Rollover instead.</>
            )}
          </p>
        )}

        {!isEdit && sortedCycles.length > 0 && (
          <div>
            <label className="m-label">Roll forward fees from (optional)</label>
            <select
              value={rollForwardFromId}
              onChange={(e) => setRollForwardFromId(e.target.value)}
              className="m-select"
            >
              <option value="">- None, start fresh -</option>
              {sortedCycles.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.feeItemCount} {c.feeItemCount === 1 ? 'fee' : 'fees'})
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--color-neutral-700)] mt-1">
              Copies all fee items from chosen term. You can then edit prices for this term.
            </p>
          </div>
        )}

        {!isEdit && (
          activationBlockedByDraftSession ? (
            <div className="pl-3 py-2 border-l-2 border-[var(--color-ochre)] text-xs text-[var(--color-ochre-text)]">
              This session is still a draft, so this term will be saved as a draft too. Set the session as current from the Sessions tab in Academic Structure, then activate this term.
            </div>
          ) : (
            <div style={{ border: `2px solid ${INK}`, background: '#fff' }}>
              <OptRow
                on={activateImmediately}
                onClick={() => setActivateImmediately(v => !v)}
                title="Activate immediately"
                hint="Otherwise, this term will be saved as a draft"
                last
              />
            </div>
          )
        )}

        {error && (
          <div className="pl-3 py-2 border-l-2 border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
            {error}
          </div>
        )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5" style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 16 }}>
          <button onClick={onClose} disabled={saving} className="m-btn m-btn-outline">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving} className="m-btn m-btn-primary">
            {saving ? 'Saving...' : isEdit ? 'Save changes' : (activateImmediately ? 'Create & activate' : 'Save as draft')}
          </button>
        </div>
      </aside>
    </div>
  )
}
