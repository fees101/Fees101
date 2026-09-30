'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SessionRow } from '@/lib/queries/fees'
import { createSession, setActiveSession, closeSession } from '@/app/(app)/fees/cycles/actions'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import { formatDate } from '@/lib/format/date'
import { useCan } from '@/lib/auth/PermissionsProvider'

interface Props {
  sessions: SessionRow[]
  termCounts: Record<string, number>
  actorName: string
  onClose: () => void
  // Fires a "Change saved" toast in the parent — SessionsTab itself unmounts
  // on close, so the confirmation has to live one level up.
  onSaved: (message: string) => void
}

// Matches the App Shell canvas's generic field-edit drawer for "Current
// session" (Current / Choose one / note / Reason / Recorded as / Save-Cancel),
// with "+ New session" and "Close" (a draft/active session, independent of
// which one is current) preserved as the two actions the canvas's plain
// choice list doesn't have room for.
export default function SessionsTab({ sessions, termCounts, actorName, onClose, onSaved }: Props) {
  const router = useRouter()
  const canRunYearEnd = useCan('run-year-end')
  const activeSession = sessions.find(s => s.status === 'active') || null

  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', startDate: '', endDate: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState(activeSession?.id || '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState<SessionRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleAdd() {
    setAddError(null)
    if (!addForm.name.trim()) return setAddError('Session name is required')
    if (!addForm.startDate || !addForm.endDate) return setAddError('Start and end dates are required')
    setAddSaving(true)
    const result = await createSession(addForm)
    setAddSaving(false)
    if (result.error) {
      setAddError(result.error)
      return
    }
    setAddForm({ name: '', startDate: '', endDate: '' })
    setShowAdd(false)
    onSaved(`Session "${addForm.name}" created.`)
    router.refresh()
  }

  async function handleSave() {
    setError(null)
    if (!selectedId || selectedId === activeSession?.id) {
      onClose()
      return
    }
    setSaving(true)
    const result = await setActiveSession(selectedId, reason)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    const newName = sessions.find(s => s.id === selectedId)?.name || activeSession?.name
    router.refresh()
    onSaved(`Current session set to ${newName} — recorded in the audit log.`)
    onClose()
  }

  async function handleClose() {
    if (!confirmClose) return
    setError(null)
    setBusyId(confirmClose.id)
    const result = await closeSession(confirmClose.id)
    setBusyId(null)
    if (result.error) {
      setError(result.error)
      return
    }
    const closedName = confirmClose.name
    setConfirmClose(null)
    onSaved(`"${closedName}" closed — recorded in the audit log.`)
    router.refresh()
  }

  if (showAdd) {
    return (
      <div className="border-2 border-[var(--color-ink)] flex flex-col m-anim-slab">
        <div className="p-5 border-b-2 border-[var(--color-ink)] flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">New session</h3>
          <button onClick={() => { setShowAdd(false); setAddError(null) }} aria-label="Close" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
            Close
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="m-label">Session name</span>
            <input
              type="text"
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              placeholder="e.g. 2027/2028"
              autoFocus
              className="m-input"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="m-label">Start date</span>
              <input
                type="date"
                value={addForm.startDate}
                onChange={(e) => setAddForm({ ...addForm, startDate: e.target.value })}
                className="m-input"
              />
            </label>
            <label className="block">
              <span className="m-label">End date</span>
              <input
                type="date"
                value={addForm.endDate}
                onChange={(e) => setAddForm({ ...addForm, endDate: e.target.value })}
                className="m-input"
              />
            </label>
          </div>

          {addError && (
            <div className="p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {addError}
            </div>
          )}

          <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]">
            Creating a session on its own doesn&apos;t move any students up a class.{' '}
            {canRunYearEnd ? (
              <>
                If this is for a new academic year, use{' '}
                <Link href="/fees/year-end" className="underline hover:text-[var(--color-ink)]">
                  Year-End Rollover
                </Link>{' '}
                instead — it promotes students and can create the new session for you.
              </>
            ) : (
              'If this is for a new academic year, Year-End Rollover promotes students and can create the new session for you.'
            )}
          </p>
        </div>

        <div className="p-5 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={() => { setShowAdd(false); setAddError(null) }} disabled={addSaving} className="m-btn m-btn-outline">
            Cancel
          </button>
          <button onClick={handleAdd} disabled={addSaving} className="m-btn m-btn-primary">
            {addSaving ? 'Creating...' : 'Create session'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-end" style={{ marginBottom: 16 }}>
        <button onClick={() => setShowAdd(true)} className="m-btn m-btn-primary m-btn-sm flex-shrink-0">
          + New session
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', marginBottom: 5, color: 'var(--color-ink)' }}>CURRENT</span>
        <div className="text-[14px]" style={{ background: 'var(--color-surface)', border: '2px solid var(--color-neutral-300)', padding: '10px 12px', color: 'var(--color-neutral-700)' }}>
          {activeSession ? activeSession.name : 'None set'}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', marginBottom: 5, color: 'var(--color-ink)' }}>CHOOSE ONE</span>
        {sessions.length === 0 ? (
          <p className="text-sm text-[var(--color-neutral-500)] italic" style={{ padding: '16px 0' }}>No sessions yet.</p>
        ) : (
          <div style={{ border: '2px solid var(--color-ink)', background: '#fff' }}>
            {sessions.map(session => {
              const closed = session.status === 'closed'
              const selected = selectedId === session.id
              return (
                <div
                  key={session.id}
                  onClick={() => { if (!closed) setSelectedId(session.id) }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--color-neutral-300)',
                    cursor: closed ? 'default' : 'pointer',
                    background: selected ? 'var(--color-surface)' : 'transparent',
                    opacity: closed ? 0.55 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {!closed && (
                      <span
                        aria-hidden
                        style={{
                          width: 14, height: 14, flexShrink: 0,
                          border: '2px solid var(--color-ink)',
                          background: selected ? 'var(--color-ink)' : 'transparent',
                        }}
                      />
                    )}
                    <span className="text-[14px]" style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{session.name}</span>
                    <span className="text-xs text-[var(--color-neutral-700)] m-num">
                      {formatDate(session.startDate)} – {formatDate(session.endDate)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span className="text-xs text-[var(--color-neutral-700)] m-num">
                      {termCounts[session.id] || 0} {termCounts[session.id] === 1 ? 'term' : 'terms'}
                    </span>
                    {session.status === 'active' && (
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink)]">Active</span>
                    )}
                    {session.status === 'closed' && (
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-500)]">Closed</span>
                    )}
                    {!closed && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setConfirmClose(session) }}
                        disabled={busyId === session.id}
                        className="text-xs font-semibold text-[var(--color-ochre-text)] hover:underline disabled:opacity-50"
                      >
                        Close
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]" style={{ marginBottom: 16 }}>
        Invoices are filed under the session current at the time they are generated. Closing a session here does not change which one is current.
      </p>

      <div style={{ marginBottom: 18 }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', marginBottom: 5, color: 'var(--color-ink)' }}>REASON (OPTIONAL)</span>
        <input
          type="text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Shown in the audit log"
          className="m-input"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 14, marginBottom: 18 }}>
        <p className="text-[12px]" style={{ margin: 0, lineHeight: 1.5, color: 'var(--color-neutral-700)' }}>
          Recorded as <strong style={{ color: 'var(--color-ink)' }}>{actorName}</strong> in Team &amp; Trust → Audit log.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 text-sm text-[var(--color-signal-text)]" style={{ borderLeft: '3px solid var(--color-signal)' }}>
          {error}
        </div>
      )}

      <div className="flex items-center gap-[10px]">
        <button
          onClick={handleSave}
          disabled={saving || !selectedId}
          className="m-btn m-btn-primary"
          style={{ flex: 1 }}
        >
          {saving ? 'Saving...' : 'Save change'}
        </button>
        <button onClick={onClose} disabled={saving} className="m-btn m-btn-outline">Cancel</button>
      </div>

      {confirmClose && (
        <DestructiveConfirmModal
          eyebrow="This cannot be undone"
          title={`Close "${confirmClose.name}"?`}
          description="The session is marked closed. Its terms and invoices stay exactly as they are, but the session itself can't be reopened or set as current again — only support can recover a closed session."
          rows={[
            {
              label: 'Terms filed under this session',
              value: termCounts[confirmClose.id] || 0,
              emphasize: true,
            },
          ]}
          note="You'll need to set a different session as current before creating new terms."
          error={error}
          actions={[
            { label: 'Cancel', onClick: () => setConfirmClose(null), variant: 'outline', disabled: busyId === confirmClose.id },
            { label: busyId === confirmClose.id ? 'Closing...' : 'Close session', onClick: handleClose, variant: 'danger', disabled: busyId === confirmClose.id },
          ]}
        />
      )}
    </>
  )
}
