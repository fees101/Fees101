'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptManualPaymentLiability } from '@/app/(app)/discounts/manual-payments/actions'
import Toast from '@/components/ui/Toast'

const INK = 'var(--color-ink)'
const BODY = 'var(--color-neutral-800)'
const META = 'var(--color-neutral-700)'
const RULE_SOFT = 'var(--color-neutral-300)'
const SIGNAL = 'var(--color-signal-text)'

// Owner-only acceptance of the manual payment responsibility note. Until this
// is accepted, no one at the school can record a manual payment. Deliberately
// plain and matter-of-fact, not a warning banner: it states who is responsible
// for what, and the owner accepts once per version.
export default function ManualPaymentLiabilityGate({ version }: { version: string }) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleAccept() {
    setError(null)
    setBusy(true)
    const r = await acceptManualPaymentLiability(accepted)
    setBusy(false)
    if ('error' in r) {
      setError(r.error)
      setToast({ ok: false, message: r.error })
      return
    }
    setToast({ ok: true, message: 'Manual payment entry is now available.' })
    router.refresh()
  }

  return (
    <div className="px-4 sm:px-7 py-7">
      <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 18, maxWidth: '72ch' }}>
        <h2 className="text-[25px] font-extrabold tracking-[-0.015em]" style={{ color: INK, margin: '0 0 6px' }}>
          Before recording manual payments
        </h2>
        <p className="text-[14px] leading-[1.6]" style={{ color: BODY, margin: '0 0 18px' }}>
          Manual entry lets your staff record cash, POS and cheque payments that did not come through the automatic
          transfer pipeline. Because Fees101 never sees that money move, the responsibility for what gets recorded
          sits with your school. Please read this and accept it as the owner before turning it on for your team.
        </p>

        <ul className="text-[14px] leading-[1.6]" style={{ color: BODY, margin: '0 0 18px', paddingLeft: 18, listStyle: 'disc' }}>
          <li style={{ margin: '0 0 8px' }}>
            Your staff record what they have actually collected. Fees101 cannot verify a cash or POS payment, so the
            figure on a receipt to a parent is only as accurate as what your staff enter.
          </li>
          <li style={{ margin: '0 0 8px' }}>
            Entries you record yourself apply to the account straight away. Entries recorded by other staff wait for
            someone with approval rights to sign off first.
          </li>
          <li style={{ margin: '0 0 8px' }}>
            A mistake is corrected with a reversal that is recorded and sent to the parent as a correction, never a
            silent edit. Every entry and reversal is kept in the audit log.
          </li>
          <li style={{ margin: 0 }}>
            Your school is responsible for the accuracy of these entries and for any receipt sent to a parent on the
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
            I am the school owner and I accept responsibility for the manual payments my staff record.
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
