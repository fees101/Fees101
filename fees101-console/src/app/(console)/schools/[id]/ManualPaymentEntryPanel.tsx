'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setManualPaymentEntryEnabled } from './manualPaymentEntryActions'

interface Props {
  schoolId: string
  enabled: boolean
  enabledAt: string | null
  enabledById: string | null
  enabledByName: string | null
  liabilityVersion: string | null
  liabilityAcceptedAt: string | null
}

// Manual payment entry control. Fees101 staff turn this on per school, and only
// after a signed liability agreement is in place (the confirmation checkbox is
// the staff-side gate). The school owner must also accept the in-app liability
// affirmation on the fees101-web side before the feature works for the school;
// that state is shown here read-only.
export default function ManualPaymentEntryPanel({
  schoolId,
  enabled,
  enabledAt,
  enabledById,
  enabledByName,
  liabilityVersion,
  liabilityAcceptedAt,
}: Props) {
  const router = useRouter()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—'

  async function handleSet(next: boolean) {
    setBusy(true)
    setMessage(null)
    // Disabling ignores the confirmation; enabling sends the checkbox value as
    // the real confirmation that the server gate checks.
    const result = await setManualPaymentEntryEnabled(schoolId, next, next ? confirmed : false)
    setBusy(false)
    if ('error' in result) {
      setMessage(`Update failed: ${result.error}`)
    } else {
      setConfirmed(false)
      router.refresh()
    }
  }

  const liabilityAccepted = !!liabilityAcceptedAt

  return (
    <div className="panel" style={{ padding: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Manual payment entry — Fees101-staff control, off by default
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Status</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{enabled ? 'Enabled' : 'Disabled'}</div>
        </div>
        {enabled && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Enabled</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {fmtDate(enabledAt)}
              {enabledByName ? ` by ${enabledByName}` : enabledById ? ` by admin ${enabledById}` : ''}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Owner liability affirmation</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {liabilityAccepted
              ? `Accepted ${fmtDate(liabilityAcceptedAt)}${liabilityVersion ? ` (v${liabilityVersion})` : ''}`
              : 'Not accepted yet'}
          </div>
        </div>
      </div>

      {!liabilityAccepted && (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
          The school owner has not accepted the in-app liability affirmation. Until they do in fees101-web,
          the school cannot use manual payment entry even if it is enabled here.
        </p>
      )}

      {enabled ? (
        <button className="btn" disabled={busy} onClick={() => handleSet(false)}>
          {busy ? 'Working…' : 'Disable manual payment entry'}
        </button>
      ) : (
        <div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>A signed liability agreement for manual payment entry is in place with this school.</span>
          </label>
          <button className="btn btn-primary" disabled={!confirmed || busy} onClick={() => handleSet(true)}>
            {busy ? 'Working…' : 'Enable manual payment entry'}
          </button>
        </div>
      )}

      {message && <p style={{ fontSize: 13, marginTop: 14, color: 'var(--accent)' }}>{message}</p>}
    </div>
  )
}
