'use client'

import { useEffect, useState } from 'react'
import {
  getSchoolTerminals,
  refreshTerminals,
  renameTerminal,
  type SchoolTerminalRow,
} from '@/app/(app)/terminal-actions'
import { formatDate } from '@/lib/format/date'

// Card terminals (Paystack) settings — discover the school's registered devices
// and label them. Rendered only for Paystack schools. See
// docs/pos-terminal-integration.md. Writes go through the server actions
// (manage-payment-config gated), never direct to the service-role-only table.
export default function TerminalsSettingsPanel() {
  const [terminals, setTerminals] = useState<SchoolTerminalRow[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [savingLabel, setSavingLabel] = useState(false)

  async function load() {
    const list = await getSchoolTerminals().catch(() => [])
    setTerminals(list)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    setNote(null)
    const result = await refreshTerminals().catch(() => null)
    setRefreshing(false)
    if (!result || !result.ok) {
      setNote({ ok: false, message: result?.error || 'Could not reach Paystack. Try again.' })
      return
    }
    setNote({ ok: true, message: `Found ${result.count ?? 0} terminal${result.count === 1 ? '' : 's'}.` })
    await load()
  }

  function startRename(t: SchoolTerminalRow) {
    setEditingId(t.terminalId)
    setLabelDraft(t.label)
    setNote(null)
  }

  async function saveLabel(terminalId: string) {
    setSavingLabel(true)
    const result = await renameTerminal(terminalId, labelDraft).catch(() => null)
    setSavingLabel(false)
    if (!result || !result.ok) {
      setNote({ ok: false, message: result?.error || 'Could not rename the terminal.' })
      return
    }
    setEditingId(null)
    await load()
  }

  return (
    <div style={{ maxWidth: 1100, marginTop: 40 }}>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
              Card terminals
            </h2>
            <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
              Collect card, USSD or transfer payments in person on a Paystack Terminal. Order a device from your
              Paystack dashboard, then refresh to register it here. Charges are started from a student&apos;s invoice —
              the amount is confirmed on the device and recorded automatically.
            </p>
          </div>
          <button onClick={handleRefresh} disabled={refreshing} className="m-btn m-btn-outline m-btn-sm whitespace-nowrap">
            {refreshing ? 'Refreshing…' : 'Refresh from Paystack'}
          </button>
        </div>
      </div>

      {note && (
        <div
          className="mt-4 p-3 text-sm"
          style={{
            background: note.ok ? 'var(--color-ledger-100, var(--color-neutral-100))' : 'var(--color-signal-100)',
            borderLeft: `3px solid ${note.ok ? 'var(--color-ledger)' : 'var(--color-signal)'}`,
            color: note.ok ? 'var(--color-ink)' : 'var(--color-signal-text)',
          }}
        >
          {note.message}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {terminals === null ? (
          <p className="text-sm text-[var(--color-neutral-700)] py-4">Loading terminals…</p>
        ) : terminals.length === 0 ? (
          <p className="text-sm text-[var(--color-neutral-700)] py-4">
            No terminals registered yet. Order a Paystack Terminal from your Paystack dashboard, then use
            &ldquo;Refresh from Paystack&rdquo; above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="m-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Serial</th>
                  <th>Status</th>
                  <th>Last seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {terminals.map((t) => (
                  <tr key={t.terminalId}>
                    <td>
                      {editingId === t.terminalId ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            className="m-input"
                            placeholder="e.g. Front desk"
                          />
                          <button onClick={() => saveLabel(t.terminalId)} disabled={savingLabel} className="m-btn m-btn-primary m-btn-sm">
                            {savingLabel ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingId(null)} disabled={savingLabel} className="m-btn m-btn-outline m-btn-sm">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm font-medium text-[var(--color-ink)]">{t.label}</span>
                      )}
                    </td>
                    <td className="text-sm text-[var(--color-neutral-700)] m-num">{t.serial || '—'}</td>
                    <td className="text-sm text-[var(--color-neutral-700)]">{t.status || '—'}</td>
                    <td className="text-sm text-[var(--color-neutral-700)] m-num">
                      {t.lastSeenAt ? formatDate(t.lastSeenAt) : '—'}
                    </td>
                    <td className="text-right">
                      {editingId !== t.terminalId && (
                        <button
                          onClick={() => startRename(t)}
                          className="text-xs font-semibold hover:text-[var(--color-signal-text)]"
                          style={{ letterSpacing: '0.08em', color: 'var(--color-ink)' }}
                        >
                          RENAME
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
