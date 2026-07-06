'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SessionRow } from '@/lib/queries/fees'
import { createSession, setActiveSession, closeSession } from '@/app/(app)/fees/cycles/actions'
import ConfirmDialog from '@/components/ConfirmDialog'

interface Props {
  sessions: SessionRow[]
  termCounts: Record<string, number>
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function SessionsTab({ sessions, termCounts }: Props) {
  const router = useRouter()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState<SessionRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleAdd() {
    setError(null)
    if (!form.name.trim()) return setError('Session name is required')
    if (!form.startDate || !form.endDate) return setError('Start and end dates are required')
    setSaving(true)
    const result = await createSession(form)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setForm({ name: '', startDate: '', endDate: '' })
    setShowAdd(false)
    router.refresh()
  }

  async function handleSetActive(session: SessionRow) {
    setError(null)
    setBusyId(session.id)
    const result = await setActiveSession(session.id)
    setBusyId(null)
    if (result.error) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  async function handleClose() {
    if (!confirmClose) return
    setError(null)
    setBusyId(confirmClose.id)
    const result = await closeSession(confirmClose.id)
    setBusyId(null)
    setConfirmClose(null)
    if (result.error) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between gap-4 mb-1">
          <h2 className="text-navy font-semibold text-lg">Sessions</h2>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 flex-shrink-0"
          >
            + New session
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Academic years, like 2026/2027. Terms are created inside a session from Billing cycles.
        </p>

        {showAdd && (
          <div className="mb-4 p-4 bg-mint-light/30 border border-mint/20 rounded-lg space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Session name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. 2027/2028"
                autoFocus
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start date</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End date</label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAdd}
                disabled={saving}
                className="px-3 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create session'}
              </button>
              <button
                onClick={() => { setShowAdd(false); setError(null) }}
                className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {sessions.length === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-8">No sessions yet.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map(session => (
              <div key={session.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 border border-gray-200 rounded-lg">
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${session.status === 'active' ? 'bg-mint' : 'bg-gray-400'}`} />
                  <span className="text-sm font-medium text-navy">{session.name}</span>
                  <span className="text-xs text-gray-400">
                    {formatDate(session.startDate)} – {formatDate(session.endDate)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${session.status === 'active' ? 'bg-mint-light text-mint' : 'bg-gray-100 text-gray-600'}`}>
                    {session.status}
                  </span>
                  <span className="text-xs text-gray-400">
                    {termCounts[session.id] || 0} {termCounts[session.id] === 1 ? 'term' : 'terms'}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {session.status !== 'active' && (
                    <button
                      onClick={() => handleSetActive(session)}
                      disabled={busyId === session.id}
                      className="text-xs text-mint font-medium hover:underline disabled:opacity-50"
                    >
                      Set current
                    </button>
                  )}
                  {session.status === 'active' && (
                    <button
                      onClick={() => setConfirmClose(session)}
                      disabled={busyId === session.id}
                      className="text-xs text-amber-600 font-medium hover:underline disabled:opacity-50"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmClose && (
        <ConfirmDialog
          title={`Close "${confirmClose.name}"?`}
          message="The session will be marked closed. Existing terms are unaffected, but you'll need to set a different session as current before creating new ones."
          confirmLabel="Close session"
          onConfirm={handleClose}
          onCancel={() => setConfirmClose(null)}
        />
      )}
    </>
  )
}
