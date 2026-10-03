'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deactivateSchoolMandate } from './actions'

interface Props {
  schoolId: string
}

// Founder-only hard stop for a school's mandate, shown next to the mandate
// facts in MandateBillingPanel. Destructive and hard to reverse (it ends
// automatic billing at Paystack), so it needs an explicit second click
// before it fires rather than acting on the first one.
export default function DeactivateMandateButton({ schoolId }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleConfirm() {
    setBusy(true)
    try {
      await deactivateSchoolMandate(schoolId)
      setMessage('Mandate deactivated.')
      router.refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to deactivate mandate.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 13 }}>Deactivate this mandate at Paystack? This cannot be undone.</span>
        <button className="btn btn-danger" disabled={busy} onClick={handleConfirm}>
          {busy ? 'Deactivating…' : 'Confirm deactivation'}
        </button>
        <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button className="btn btn-danger" onClick={() => setConfirming(true)}>Deactivate mandate</button>
      {message && <p style={{ fontSize: 13, marginTop: 10, color: 'var(--accent)' }}>{message}</p>}
    </div>
  )
}
