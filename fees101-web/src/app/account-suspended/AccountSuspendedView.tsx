'use client'

import { useEffect, useState } from 'react'
import { getSuspensionPaymentInfo, startMandateReconnect } from './actions'

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

export default function AccountSuspendedView({ schoolName, isOwner }: { schoolName: string; isOwner: boolean }) {
  const [loading, setLoading] = useState(isOwner)
  const [error, setError] = useState<string | null>(null)
  const [pay, setPay] = useState<
    { accountNumber: string; bankName: string; outstanding: number; billingMethod: 'mandate' | 'dva'; retriesExhausted: boolean } | null
  >(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOwner) return
    getSuspensionPaymentInfo().then((result) => {
      setLoading(false)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setPay(result)
    })
  }, [isOwner])

  async function handleReconnect() {
    setReconnectError(null)
    setReconnecting(true)
    const result = await startMandateReconnect()
    if ('url' in result) {
      window.location.href = result.url
      return
    }
    setReconnectError(result.error)
    setReconnecting(false)
  }

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[460px] border-2 border-[var(--color-ink)] bg-white p-6">
        <Wordmark />

        {!isOwner ? (
          <>
            <h1 className="text-xl font-extrabold leading-[1.2] mb-3" style={{ color: 'var(--color-signal-text)' }}>
              {schoolName} is suspended
            </h1>
            <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
              Access is paused for non-payment. Only the school owner can settle this and restore it —
              please contact them.
            </p>
            <a href="/logout" className="m-btn m-btn-outline w-full justify-start">Sign out</a>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-extrabold leading-[1.1] mb-3" style={{ letterSpacing: '-0.02em', color: 'var(--color-signal-text)' }}>
              {schoolName} is suspended
            </h1>
            <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
              Access was suspended after repeated unpaid charges. Settle the balance below to restore it
              immediately.
            </p>

            {loading && (
              <p className="text-sm text-[var(--color-neutral-700)] mb-5">Loading your payment details...</p>
            )}

            {error && (
              <p className="text-[13px] leading-[1.5] mb-5" style={{ color: 'var(--color-signal-text)' }}>
                {error}
              </p>
            )}

            {pay && (
              <>
                <div className="mb-5" style={{ borderTop: '2px solid var(--color-ink)', borderBottom: '1px solid var(--color-neutral-300)' }}>
                  <Row label="AMOUNT OUTSTANDING" value={naira(pay.outstanding)} />
                  <Row label="ACCOUNT NUMBER" value={pay.accountNumber} />
                  <Row label="BANK" value={pay.bankName} last />
                </div>
                <p className="text-[12.5px] leading-[1.5] text-[var(--color-neutral-700)] mb-4">
                  Transfer the outstanding amount to the account above. Access restores automatically once
                  the transfer lands.
                </p>
                <a href="/account-suspended" className="m-btn m-btn-outline w-full justify-start">
                  I&apos;ve made the transfer — refresh
                </a>

                {pay.billingMethod === 'mandate' && (
                  <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--color-neutral-200)' }}>
                    <p className="text-[12.5px] leading-[1.5] text-[var(--color-neutral-700)] mb-3">
                      {pay.retriesExhausted
                        ? 'We stopped retrying your card/bank automatically after repeated failures. Reconnect a payment method to resume automatic billing.'
                        : 'We keep retrying your card/bank automatically — or reconnect a payment method now instead of waiting.'}
                    </p>
                    {reconnectError && (
                      <p className="text-[13px] leading-[1.5] mb-3" style={{ color: 'var(--color-signal-text)' }}>
                        {reconnectError}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleReconnect}
                      disabled={reconnecting}
                      className="m-btn m-btn-primary w-full justify-start"
                    >
                      {reconnecting ? 'Opening secure checkout…' : 'Reconnect payment method'}
                    </button>
                  </div>
                )}
              </>
            )}
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
