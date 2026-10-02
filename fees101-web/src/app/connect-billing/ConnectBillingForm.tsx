'use client'

import { useState } from 'react'
import { startBillingConnection } from './actions'

// FEES101 wordmark + red rule — same logged-out branding as set-password.
function Wordmark() {
  return (
    <div className="flex items-baseline gap-2 mb-6">
      <span className="text-[14px] font-extrabold" style={{ letterSpacing: '0.14em', color: 'var(--color-ink)' }}>FEES101</span>
      <span className="inline-block" style={{ width: 24, height: 2, backgroundColor: 'var(--color-signal)' }} />
    </div>
  )
}

function naira(n: number) {
  return '₦' + Math.round(n).toLocaleString('en-NG')
}

// Maps a callback error code to a human line. Kept here so the callback route
// can stay terse (?error=code) and the copy lives with the screen.
const ERROR_COPY: Record<string, string> = {
  missing_reference: 'That did not complete. Please try connecting billing again.',
  reference_mismatch: 'We could not match that payment to your school. Please try again.',
  verify_failed: 'We could not confirm the payment with Paystack. Please try again.',
  payment_failed: 'The setup payment did not go through. No charge was made, please try again.',
}

export default function ConnectBillingForm({
  schoolName,
  setupFee,
  freeDays,
  pricePerStudent,
  termsVersion,
  isOwner,
  initialErrorCode,
}: {
  schoolName: string
  setupFee: number
  freeDays: number
  pricePerStudent: number
  termsVersion: string
  isOwner: boolean
  initialErrorCode: string | null
}) {
  const [accepted, setAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(
    initialErrorCode ? ERROR_COPY[initialErrorCode] || 'Something went wrong. Please try again.' : null,
  )

  async function handleConnect() {
    setError(null)
    setSubmitting(true)
    const result = await startBillingConnection(accepted)
    if ('url' in result) {
      window.location.href = result.url // hosted Paystack checkout
      return
    }
    setError(result.error)
    setSubmitting(false)
  }

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[460px] border-2 border-[var(--color-ink)] bg-white p-6">
        <Wordmark />

        {!isOwner ? (
          <>
            <h1 className="text-xl font-extrabold text-[var(--color-ink)] mb-3 leading-[1.2]">
              Billing is not set up yet
            </h1>
            <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
              {schoolName} cannot be used until the school owner connects billing. Ask them to sign in.
              They will see this step and can set it up in a minute.
            </p>
            <a href="/login" className="m-btn m-btn-outline w-full justify-start">Back to sign in</a>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-extrabold text-[var(--color-ink)] mb-3 leading-[1.1]" style={{ letterSpacing: '-0.02em' }}>
              Connect billing
            </h1>
            <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
              One quick step to switch on {schoolName}. You authorize an automatic bank debit so your monthly
              platform fee is collected on its own, with no reminders and no manual transfers.
            </p>

            {/* The terms of the agreement, stated plainly. */}
            <div className="mb-5" style={{ borderTop: '2px solid var(--color-ink)', borderBottom: '1px solid var(--color-neutral-300)' }}>
              <Row label="SETUP FEE TODAY" value={`${naira(setupFee)} (one-time, nonrefundable)`} />
              <Row label="FREE PERIOD" value={`${freeDays} days, no charge`} />
              <Row label="AFTER THAT" value={`${naira(pricePerStudent)} per student / month`} />
              <Row label="HOW IT IS COLLECTED" value="Automatic debit from your bank" last />
            </div>

            <p className="text-[12.5px] leading-[1.5] text-[var(--color-neutral-700)] mb-4">
              Paying the setup fee authorizes a direct-debit mandate on your bank account. We use it to collect
              your monthly fee automatically after the free period. You can cancel the mandate at any time, which
              ends your use of the platform.
            </p>

            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-[3px]"
              />
              <span className="text-[13px] leading-[1.5] text-[var(--color-neutral-800)]">
                I am authorized to set up billing for {schoolName} and I accept the billing terms.
              </span>
            </label>

            {error && (
              <p className="text-[13px] leading-[1.5] mb-4" style={{ color: 'var(--color-signal-text)' }}>
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleConnect}
              disabled={!accepted || submitting}
              className="m-btn m-btn-primary w-full justify-start"
            >
              {submitting ? 'Opening secure checkout...' : `Pay ${naira(setupFee)} and connect billing`}
            </button>

            <p className="text-[11px] leading-[1.5] text-[var(--color-neutral-700)] mt-4 pt-3" style={{ borderTop: '1px solid var(--color-neutral-300)' }}>
              Secured by Paystack. Terms version {termsVersion}.
            </p>
          </>
        )}
      </div>
    </main>
  )
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-2.5"
      style={last ? undefined : { borderBottom: '1px solid var(--color-neutral-200)' }}
    >
      <span className="text-[11px] font-semibold text-[var(--color-neutral-700)] shrink-0" style={{ letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span className="text-[13px] font-semibold text-[var(--color-ink)] text-right">{value}</span>
    </div>
  )
}
