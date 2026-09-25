'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setAnnualPrice, startCardCapture, chargeNow, runSuspensionCheck, setBillingStatusManually } from './actions'

interface Props {
  schoolId: string
  billing: {
    annualPrice: number
    billingStatus: string
    hasSavedCard: boolean
    paystackEmail: string | null
  }
}

export default function BillingPanel({ schoolId, billing }: Props) {
  const router = useRouter()
  const [price, setPrice] = useState(String(billing.annualPrice || ''))
  const [email, setEmail] = useState(billing.paystackEmail || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSetPrice() {
    setBusy(true)
    await setAnnualPrice(schoolId, Number(price) || 0)
    setBusy(false)
    setMessage('Annual price saved.')
    router.refresh()
  }

  async function handleCapture() {
    if (!email) { setMessage('Enter a billing email first.'); return }
    setBusy(true)
    try {
      const { url } = await startCardCapture(schoolId, email)
      window.location.href = url
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to start card capture.')
      setBusy(false)
    }
  }

  async function handleCharge() {
    setBusy(true)
    const result = await chargeNow(schoolId)
    setBusy(false)
    setMessage('error' in result ? `Charge failed: ${result.error}` : `Charged successfully (ref ${result.reference}).`)
    router.refresh()
  }

  async function handleSuspensionCheck() {
    setBusy(true)
    const result = await runSuspensionCheck(schoolId)
    setBusy(false)
    setMessage(result ? `Status moved from ${result.from} to ${result.to}.` : 'No change — status is already up to date.')
    router.refresh()
  }

  async function handleManualStatus(status: string) {
    setBusy(true)
    await setBillingStatusManually(schoolId, status)
    setBusy(false)
    setMessage(`Status manually set to ${status}.`)
    router.refresh()
  }

  return (
    <div className="panel" style={{ padding: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Billing actions (sandbox — uses Paystack test keys)</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Annual price (₦)</label>
          <input
            value={price}
            onChange={e => setPrice(e.target.value)}
            style={{ padding: '7px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink)', width: 140 }}
          />
        </div>
        <button className="btn" disabled={busy} onClick={handleSetPrice}>Save price</button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Billing email (for Paystack)</label>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="school-owner@example.com"
            style={{ padding: '7px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink)', width: 260 }}
          />
        </div>
        <button className="btn" disabled={busy} onClick={handleCapture}>
          {billing.hasSavedCard ? 'Replace saved card' : 'Capture card (test)'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy || !billing.hasSavedCard} onClick={handleCharge}>Charge now (test)</button>
        <button className="btn" disabled={busy} onClick={handleSuspensionCheck}>Run suspension check</button>
        <button className="btn" disabled={busy} onClick={() => handleManualStatus('active')}>Set active</button>
        <button className="btn" disabled={busy} onClick={() => handleManualStatus('suspended')}>Set suspended</button>
      </div>

      {message && <p style={{ fontSize: 13, marginTop: 14, color: 'var(--accent)' }}>{message}</p>}
    </div>
  )
}
