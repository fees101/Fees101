'use client'

import { useEffect, useState } from 'react'
import { startBillingConnection, startDvaFallback } from './actions'

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
  existingDva,
  checkedForTransfer,
  dvaFallbackEnabled,
}: {
  schoolName: string
  setupFee: number
  freeDays: number
  pricePerStudent: number
  termsVersion: string
  isOwner: boolean
  initialErrorCode: string | null
  existingDva: { accountNumber: string; bankName: string } | null
  checkedForTransfer: boolean
  // Owner-gated: the self-serve "pay by bank transfer instead" option only
  // appears once Fees101 has enabled DVA for this school. Keeps schools on the
  // auto-debit mandate (the retention lock) by default.
  dvaFallbackEnabled: boolean
}) {
  // Terms were already accepted server-side on the first attempt that brought
  // them back here with an error, or earlier when they got as far as a DVA —
  // don't make them re-check the box on a later page load.
  const [accepted, setAccepted] = useState(!!initialErrorCode || !!existingDva)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(
    initialErrorCode ? ERROR_COPY[initialErrorCode] || 'Something went wrong. Please try again.' : null,
  )
  const [dva, setDva] = useState<{ accountNumber: string; bankName: string } | null>(existingDva)
  // Collapsed by default so automatic debit keeps top billing even once a
  // transfer account exists — only expand on request, or when they're coming
  // back specifically to check on a transfer (checkedForTransfer).
  const [showTransferDetails, setShowTransferDetails] = useState(!!checkedForTransfer)

  // If they navigate to Paystack's checkout then back out (closed tab, browser
  // back) instead of completing or landing on our callback, the browser can
  // restore this page from bfcache with submitting still stuck true — leaving
  // the button permanently disabled until a hard refresh.
  useEffect(() => {
    function handlePageShow(e: PageTransitionEvent) {
      if (e.persisted) setSubmitting(false)
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

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

  async function handleDvaFallback() {
    setError(null)
    setSubmitting(true)
    const result = await startDvaFallback(accepted)
    setSubmitting(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setDva(result)
    setShowTransferDetails(true)
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
        ) : dva && showTransferDetails ? (
          <>
            <h1 className="text-[26px] font-extrabold text-[var(--color-ink)] mb-3 leading-[1.1]" style={{ letterSpacing: '-0.02em' }}>
              Transfer to connect billing
            </h1>
            <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
              Transfer {naira(setupFee)} from your bank to the account below. This both pays the
              one-time setup fee and sets up {schoolName}&apos;s billing account — no card or mandate needed.
            </p>

            <div className="mb-5" style={{ borderTop: '2px solid var(--color-ink)', borderBottom: '1px solid var(--color-neutral-300)' }}>
              <Row label="ACCOUNT NUMBER" value={dva.accountNumber} />
              <Row label="BANK" value={dva.bankName} />
              <Row label="AMOUNT" value={naira(setupFee)} last />
            </div>

            <p className="text-[12.5px] leading-[1.5] text-[var(--color-neutral-700)] mb-4">
              Once the transfer lands, this unlocks automatically — refresh or sign in again to check. Your monthly
              fee is then collected the same way each month. You can switch to automatic bank debit instead at any
              time, so you don&apos;t have to keep transferring manually.
            </p>

            {checkedForTransfer && (
              <p className="text-[12.5px] leading-[1.5] text-[var(--color-ink)] mb-4 pt-3" style={{ borderTop: '1px solid var(--color-neutral-300)' }}>
                We haven&apos;t received a transfer yet. It usually takes a few minutes to land — if it&apos;s been
                longer, double-check the account number and bank above, or reach out if you think this is wrong.
              </p>
            )}

            {error && (
              <p className="text-[13px] leading-[1.5] mb-4" style={{ color: 'var(--color-signal-text)' }}>
                {error}
              </p>
            )}

            <a href="/connect-billing?checked=1" className="m-btn m-btn-outline w-full justify-start">
              I&apos;ve made the transfer — refresh
            </a>

            <button
              type="button"
              onClick={() => setShowTransferDetails(false)}
              className="text-[12.5px] text-[var(--color-neutral-700)] underline mt-3 block"
            >
              Back to automatic bank debit
            </button>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-extrabold text-[var(--color-ink)] mb-3 leading-[1.1]" style={{ letterSpacing: '-0.02em' }}>
              Connect billing
            </h1>
            <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
              {dva
                ? `One quick step to switch ${schoolName} to automatic bank debit. You authorize a direct debit so your monthly platform fee is collected on its own, with no manual transfers.`
                : `One quick step to switch on ${schoolName}. You authorize an automatic bank debit so your monthly platform fee is collected on its own, with no reminders and no manual transfers.`}
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
              {!dva && ' If your bank isn’t supported or your card doesn’t work, you’ll be able to pay by bank transfer instead.'}
            </p>

            {!dva && (
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
            )}

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

            {dva ? (
              <button
                type="button"
                onClick={() => setShowTransferDetails(true)}
                className="text-[12.5px] text-[var(--color-neutral-700)] underline mt-3 block"
              >
                Or pay by bank transfer instead
              </button>
            ) : error && dvaFallbackEnabled ? (
              <button
                type="button"
                onClick={handleDvaFallback}
                disabled={!accepted || submitting}
                className="text-[12.5px] text-[var(--color-neutral-700)] underline mt-3 block"
              >
                Can&apos;t get this to work? Use a bank transfer instead
              </button>
            ) : error ? (
              // Self-serve bank transfer is off for this school — don't dead-end a
              // stuck owner; point them to us so we can help (and enable DVA if
              // their bank/card genuinely can't do an auto-debit mandate).
              <p className="text-[12.5px] leading-[1.5] text-[var(--color-neutral-700)] mt-3">
                Still stuck? Reach out to Fees101 and we&apos;ll help you get {schoolName} connected.
              </p>
            ) : null}

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
