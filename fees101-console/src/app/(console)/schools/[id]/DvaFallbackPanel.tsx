'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setDvaFallbackEnabled } from './dvaFallbackActions'

interface Props {
  schoolId: string
  enabled: boolean
  enabledAt: string | null
  enabledById: string | null
  enabledByName: string | null
  // Current collection rail, read-only context so staff can see whether the
  // school is already on an active auto-debit mandate before loosening it.
  billingMethod: string
  mandateStatus: string
}

// Bank-transfer (DVA) fallback control. Fees101 staff turn this on per school.
// The auto-debit mandate is the preferred rail because it is what keeps a school
// on the platform; bank transfer is a reluctant last resort. Enabling this lets
// the school pick "pay by bank transfer instead" on /connect-billing in
// fees101-web. Keep it off unless the school's bank or card genuinely cannot
// establish a mandate.
export default function DvaFallbackPanel({
  schoolId,
  enabled,
  enabledAt,
  enabledById,
  enabledByName,
  billingMethod,
  mandateStatus,
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
    const result = await setDvaFallbackEnabled(schoolId, next, next ? confirmed : false)
    setBusy(false)
    if ('error' in result) {
      setMessage(`Update failed: ${result.error}`)
    } else {
      setConfirmed(false)
      router.refresh()
    }
  }

  const onActiveMandate = billingMethod === 'mandate' && mandateStatus === 'active'
  const railLabel = billingMethod === 'dva' ? 'Bank transfer (DVA)' : `Auto-debit mandate (${mandateStatus})`

  return (
    <div className="panel" style={{ padding: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Bank transfer (DVA) fallback — Fees101-staff control, off by default
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
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Current rail</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{railLabel}</div>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
        Enabling this lets the school choose to pay by manual bank transfer instead of auto-debit on
        /connect-billing. The auto-debit mandate is the preferred rail, so keep this off unless the school&apos;s
        bank or card genuinely cannot establish a mandate.
      </p>

      {enabled ? (
        <button className="btn" disabled={busy} onClick={() => handleSet(false)}>
          {busy ? 'Working…' : 'Disable bank transfer (DVA)'}
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
            <span>
              This school&apos;s bank or card cannot establish an auto-debit mandate, so bank transfer is a genuine
              last resort.
            </span>
          </label>
          {onActiveMandate && (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Note: this school is already on an active auto-debit mandate. Only enable bank transfer if that mandate
              can no longer be used.
            </p>
          )}
          <button className="btn btn-primary" disabled={!confirmed || busy} onClick={() => handleSet(true)}>
            {busy ? 'Working…' : 'Enable bank transfer (DVA)'}
          </button>
        </div>
      )}

      {message && <p style={{ fontSize: 13, marginTop: 14, color: 'var(--accent)' }}>{message}</p>}
    </div>
  )
}
