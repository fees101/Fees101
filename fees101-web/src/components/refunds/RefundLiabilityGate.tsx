'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptRefundsLiability } from '@/app/(app)/money/refunds/actions'
import Toast from '@/components/ui/Toast'

const INK = 'var(--color-ink)'
const BODY = 'var(--color-neutral-800)'
const META = 'var(--color-neutral-700)'
const RULE_SOFT = 'var(--color-neutral-300)'
const SIGNAL = 'var(--color-signal-text)'

// Owner-only acceptance of the refunds responsibility note. Until this is
// accepted, no one at the school can request or approve a refund. Deliberately
// plain and matter-of-fact, not a warning banner: it states who is responsible
// for what, and the owner accepts once per version.
export default function RefundLiabilityGate({ version, provider }: { version: string; provider?: string | null }) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)

  // Names the school's own connected provider rather than always saying
  // "Paystack" — a Monnify school was shown Paystack-specific wording here
  // even though it has no Paystack account to fund a refund from.
  const providerLabel = provider === 'monnify' ? 'Monnify' : 'Paystack'

  async function handleAccept() {
    setError(null)
    setBusy(true)
    const r = await acceptRefundsLiability(accepted)
    setBusy(false)
    if ('error' in r) {
      setError(r.error)
      setToast({ ok: false, message: r.error })
      return
    }
    setToast({ ok: true, message: 'Refunds are now available.' })
    router.refresh()
  }

  return (
    <div className="px-4 sm:px-7 py-7">
      <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 18, maxWidth: '72ch' }}>
        <h2 className="text-[25px] font-extrabold tracking-[-0.015em]" style={{ color: INK, margin: '0 0 6px' }}>
          Before processing refunds
        </h2>
        <p className="text-[14px] leading-[1.6]" style={{ color: BODY, margin: '0 0 18px' }}>
          Refunds return real money to a parent — either through {providerLabel} (funded from your school&apos;s own
          {' '}{providerLabel} balance, clawed back from upcoming settlements if it has already been paid out) or from your
          school&apos;s own bank. Please read this and accept it as the owner before turning it on for your team.
        </p>

        <ul className="text-[14px] leading-[1.6]" style={{ color: BODY, margin: '0 0 18px', paddingLeft: 18, listStyle: 'disc' }}>
          <li style={{ margin: '0 0 8px' }}>
            A {providerLabel} refund is funded from your school&apos;s own {providerLabel} balance. If the money has already been
            settled to your bank, {providerLabel} claws the refund back from your upcoming settlements instead.
          </li>
          <li style={{ margin: '0 0 8px' }}>
            A refund you request yourself applies immediately. A refund requested by other staff waits for someone
            with approval rights to sign off first.
          </li>
          <li style={{ margin: '0 0 8px' }}>
            A refund cannot exceed what remains on the original payment, and every request, approval and outcome is
            kept in the audit log.
          </li>
          <li style={{ margin: 0 }}>
            Your school is responsible for the accuracy of these refunds and for any notice sent to a parent on the
            strength of them.
          </li>
        </ul>

        <label className="flex items-start gap-2 cursor-pointer" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-[3px]"
          />
          <span className="text-[13px] leading-[1.5]" style={{ color: INK }}>
            I am the school owner and I accept responsibility for the refunds my staff process.
          </span>
        </label>

        {error && (
          <div className="pl-3 text-sm" style={{ borderLeft: `3px solid ${SIGNAL}`, color: SIGNAL, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div className="flex items-center gap-3" style={{ borderTop: `1px solid ${RULE_SOFT}`, paddingTop: 16 }}>
          <button onClick={handleAccept} disabled={!accepted || busy} className="m-btn m-btn-primary">
            {busy ? 'Saving...' : 'Accept and turn on'}
          </button>
          <span className="text-[11px]" style={{ color: META }}>Version {version}</span>
        </div>
      </div>

      {toast && <Toast message={toast.message} ok={toast.ok} onDismiss={() => setToast(null)} />}
    </div>
  )
}
