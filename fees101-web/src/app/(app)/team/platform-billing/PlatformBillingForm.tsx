'use client'

import { useState } from 'react'
import { startSwitchToMandate } from './actions'

const ERROR_COPY: Record<string, string> = {
  missing_reference: 'That did not complete. Please try again.',
  reference_mismatch: 'We could not match that payment to your school. Please try again.',
  not_connected: 'Billing is not connected yet.',
  verify_failed: 'We could not confirm the payment with Paystack. Please try again.',
  payment_failed: 'The payment did not go through. No charge was made, please try again.',
  no_mandate: 'Paystack did not return a reusable mandate. Please try again.',
  card_not_reusable:
    'That card can’t be used for automatic monthly debit (your bank/card didn’t return a reusable authorization). You’re still set up to pay by bank transfer.',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PlatformBillingForm({
  billingMethod,
  mandateStatus,
  mandateEmail,
  mandateAuthorizedAt,
  dvaAccountNumber,
  dvaBankName,
  initialErrorCode,
  justSwitched,
  cardFallbackNotice,
}: {
  billingMethod: 'mandate' | 'dva'
  mandateStatus: string | null
  mandateEmail: string | null
  mandateAuthorizedAt: string | null
  dvaAccountNumber: string | null
  dvaBankName: string | null
  initialErrorCode: string | null
  justSwitched: boolean
  cardFallbackNotice: boolean
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(
    initialErrorCode ? ERROR_COPY[initialErrorCode] || 'Something went wrong. Please try again.' : null,
  )
  const [notice] = useState<string | null>(
    justSwitched
      ? 'Switched to automatic bank debit. The mandate becomes chargeable in a few hours.'
      : cardFallbackNotice
        ? 'Your setup fee was received. That card couldn’t be used for automatic monthly debit, so you’re set up to pay by bank transfer for now. To skip manual transfers each month, you can enable automatic debit below — try again with a different card or your bank.'
        : null,
  )

  async function handleSwitchToMandate() {
    setError(null)
    setSubmitting(true)
    const result = await startSwitchToMandate()
    if ('url' in result) {
      window.location.href = result.url // hosted Paystack checkout
      return
    }
    setError(result.error)
    setSubmitting(false)
  }

  const h2 = 'text-lg font-extrabold tracking-[-0.01em] text-[var(--color-ink)]'
  const sub = 'text-[13px] text-[var(--color-neutral-700)] mt-1'

  return (
    <>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Platform billing
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          How Fees101 collects its own monthly fee from your school. This is separate from how your school
          collects fees from parents.
        </p>
      </div>

      {error && (
        <p className="text-[13px] leading-[1.5]" style={{ color: 'var(--color-signal-text)', marginTop: 16 }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="text-[13px] leading-[1.5]" style={{ color: 'var(--color-ink)', marginTop: 16 }}>
          {notice}
        </p>
      )}

      <div style={{ marginTop: 8 }}>
        <div className="m-setrow">
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>
              Current method
            </p>
            <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
              {billingMethod === 'mandate'
                ? 'Automatic debit from your bank account'
                : 'Manual bank transfer into a Fees101 account'}
            </p>
          </div>
          <div className="m-setrow__side">
            <p className="text-[15px] text-[var(--color-ink)]" style={{ margin: 0 }}>
              {billingMethod === 'mandate' ? 'Direct debit' : 'Bank transfer'}
            </p>
          </div>
        </div>

        {billingMethod === 'mandate' ? (
          <div className="m-setrow">
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>Mandate status</p>
              <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
                Billed to {mandateEmail || 'the account owner'}
              </p>
            </div>
            <div className="m-setrow__side">
              <p className="text-[15px] text-[var(--color-ink)] m-num" style={{ margin: 0 }}>
                {mandateStatus === 'active' ? 'Active' : mandateStatus === 'pending' ? 'Activating' : 'Not active'}
              </p>
              <p className="text-[12px] text-[var(--color-neutral-700)] m-num" style={{ margin: 0 }}>
                Authorized {fmtDate(mandateAuthorizedAt)}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="m-setrow">
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>
                  Transfer account
                </p>
                <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
                  Transfer your monthly fee into this account
                </p>
              </div>
              <div className="m-setrow__side">
                <p className="text-[15px] text-[var(--color-ink)] m-num" style={{ margin: 0 }}>
                  {dvaAccountNumber || 'Not yet provisioned'}
                </p>
                {dvaBankName && (
                  <p className="text-[12px] text-[var(--color-neutral-700)]" style={{ margin: 0 }}>
                    {dvaBankName}
                  </p>
                )}
              </div>
            </div>

            <div className="m-setrow">
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>
                  Switch to automatic bank debit
                </p>
                <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
                  Authorize a direct debit so your monthly fee is collected on its own, with no manual transfers.
                </p>
              </div>
              <div className="m-setrow__side">
                <button
                  type="button"
                  onClick={handleSwitchToMandate}
                  disabled={submitting}
                  className="m-btn m-btn-primary"
                >
                  {submitting ? 'Opening secure checkout…' : 'Switch to automatic bank debit'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="m-panel">
        <h2 className={h2}>About billing method</h2>
        <p className={sub}>
          {billingMethod === 'mandate'
            ? 'Your monthly fee is collected automatically. If this ever stops working — your bank isn’t supported or the card on file fails — we’ll move your account to bank transfer and let you know.'
            : 'You can connect automatic debit at any time. Once it’s active, you won’t need to make manual transfers.'}
        </p>
      </div>
    </>
  )
}
