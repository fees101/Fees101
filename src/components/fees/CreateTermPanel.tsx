'use client'

import { useState, useMemo } from 'react'
import { CycleRow, SessionRow } from '@/lib/queries/fees'
import { createTerm, updateTerm } from '@/app/(app)/fees/cycles/actions'

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
  } | null) => void
}

export default function CreateTermPanel({ mode, cycles, sessions, editingCycle, forceNewSession, onClose, onSuccess }: Props) {
  const isEdit = mode === 'edit'

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
      onSuccess(result.summary)
    } else {
      onSuccess(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-fit sticky top-6">

      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-base font-semibold text-navy">
          {isEdit ? 'Edit term' : 'Create new term'}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-5 space-y-4">

        <div>
          <label className="block text-xs text-gray-500 mb-1">Term name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Second Term 2026/2027"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start date *</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End date *</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Due date *</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
          />
          <p className="text-xs text-gray-500 mt-1">When parents should pay by</p>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-2">Session</label>
          {isEdit ? (
            <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
              {editingCycle?.sessionId
                ? <>{selectableSessions.find(s => s.id === editingCycle.sessionId)?.name || 'Unknown session'} <span className="text-xs text-gray-400">— fixed at creation, cannot be changed</span></>
                : <>No session <span className="text-xs text-gray-400">— fixed at creation, cannot be changed</span></>
              }
            </div>
          ) : (
          <div className="space-y-2">
            {selectableSessions.length > 0 && (
              <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  checked={sessionMode === 'existing'}
                  onChange={() => setSessionMode('existing')}
                  className="mt-0.5 text-mint"
                />
                <div className="flex-1">
                  <span className="text-sm text-navy">Existing session</span>
                  {sessionMode === 'existing' && (
                    <select
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                      className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                    >
                      {selectableSessions.map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.status === 'closed' ? ' (closed)' : s.status === 'draft' ? ' (draft)' : ''}</option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
            )}
            {(forceNewSession || selectableSessions.length === 0) && (
              <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  checked={sessionMode === 'new'}
                  onChange={() => setSessionMode('new')}
                  className="mt-0.5 text-mint"
                />
                <div className="flex-1">
                  <span className="text-sm text-navy">New session</span>
                  {sessionMode === 'new' && (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={newSessionName}
                        onChange={(e) => setNewSessionName(e.target.value)}
                        placeholder="e.g. 2027/2028"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={newSessionStart}
                          onChange={(e) => setNewSessionStart(e.target.value)}
                          placeholder="Start"
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                        />
                        <input
                          type="date"
                          value={newSessionEnd}
                          onChange={(e) => setNewSessionEnd(e.target.value)}
                          placeholder="End"
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </label>
            )}
            <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                checked={sessionMode === 'none'}
                onChange={() => setSessionMode('none')}
                className="mt-0.5 text-mint"
              />
              <div>
                <span className="text-sm text-navy">No session</span>
                <p className="text-xs text-gray-500">Standalone term, not part of an academic year</p>
              </div>
            </label>
          </div>
          )}
        </div>

        {!isEdit && sortedCycles.length > 0 && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Roll forward fees from (optional)</label>
            <select
              value={rollForwardFromId}
              onChange={(e) => setRollForwardFromId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            >
              <option value="">— None, start fresh —</option>
              {sortedCycles.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.feeItemCount} {c.feeItemCount === 1 ? 'fee' : 'fees'})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Copies all fee items from chosen term. You can then edit prices for this term.
            </p>
          </div>
        )}

        {!isEdit && (
          activationBlockedByDraftSession ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              This session is still a draft, so this term will be saved as a draft too. Set the session as current from Academic Structure → Sessions, then activate this term.
            </div>
          ) : (
            <div className="p-3 bg-gray-50 rounded-lg">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activateImmediately}
                  onChange={(e) => setActivateImmediately(e.target.checked)}
                  className="mt-0.5 text-mint"
                />
                <div>
                  <span className="text-sm text-navy">Activate immediately</span>
                  <p className="text-xs text-gray-500">Otherwise, this term will be saved as a draft</p>
                </div>
              </label>
            </div>
          )
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : isEdit ? 'Save changes' : (activateImmediately ? 'Create & activate' : 'Save as draft')}
        </button>
      </div>
    </div>
  )
}