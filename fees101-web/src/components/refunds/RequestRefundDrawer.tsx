'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Select from '@/components/ui/Select'
import Toast from '@/components/ui/Toast'
import { requestRefund } from '@/app/(app)/money/refunds/actions'

const CATEGORY_OPTIONS = [
  { value: 'overpayment', label: 'Overpayment' },
  { value: 'withdrawal', label: 'Student withdrawal' },
  { value: 'duplicate_payment', label: 'Duplicate payment' },
  { value: 'fee_correction', label: 'Fee correction' },
  { value: 'parent_request', label: 'Parent request' },
  { value: 'other', label: 'Other' },
]

const BANK_TRANSFER_OPTION = { value: 'bank_transfer', label: "Bank transfer (we already sent it from the school's bank)" }

// One automatic method per provider, keyed by the PAYMENT's own recorded
// provider (not the school's current setting — a payment keeps whatever
// provider actually processed it, even after a school switches providers).
// A payment made some other way (manual/cash, or no provider at all) gets no
// automatic option at all — only bank transfer, handled by the fallback below.
const AUTO_METHOD_BY_PROVIDER: Record<string, { value: string; label: string }> = {
  paystack: { value: 'paystack_reversal', label: 'Paystack refund (back to original payment method)' },
  monnify: { value: 'monnify_reversal', label: 'Monnify refund (back to original payment method)' },
}

interface RefundablePaymentInfo {
  id: string
  studentId: string
  amount: number
  cycleName?: string | null
  // When the payment was made — shown as context (this app deliberately
  // allows refunding a payment from an already-closed term; never a hard
  // limit, just make sure whoever's requesting sees how old it is).
  paidAt?: string | null
  // The provider that actually processed this payment ('paystack' | 'monnify').
  // Determines which automatic refund option (if any) is offered — never
  // offer a Paystack refund on a Monnify payment or vice versa.
  provider?: string | null
}

// Plain-language age, same formatting as RefundsWorkspace's.
function age(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`
  const years = Math.floor(months / 12)
  return years === 1 ? '1 year ago' : `${years} years ago`
}

interface Props {
  payment: RefundablePaymentInfo
  onClose: () => void
}

// Right-slide drawer, same shell as AddStudentModal/FeeFormPanel — always
// starts from a specific existing payment (never a blank "find a payment"
// form), since a refund has to reference one.
export default function RequestRefundDrawer({ payment, onClose }: Props) {
  const router = useRouter()
  const autoMethod = payment.provider ? AUTO_METHOD_BY_PROVIDER[payment.provider] : undefined
  const METHOD_OPTIONS = autoMethod ? [autoMethod, BANK_TRANSFER_OPTION] : [BANK_TRANSFER_OPTION]
  const [amount, setAmount] = useState(String(payment.amount))
  const [category, setCategory] = useState('parent_request')
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState(autoMethod ? autoMethod.value : 'bank_transfer')
  const [refundReference, setRefundReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)

  async function submit() {
    setError(null)
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return }
    if (reason.trim().length < 20) { setError('Explain the refund in at least 20 characters.'); return }
    if (refundMethod === 'bank_transfer' && refundReference.trim().length < 3) {
      setError('Add a reference (at least 3 characters) as proof the bank transfer was made.')
      return
    }

    setBusy(true)
    const r = await requestRefund({
      paymentId: payment.id,
      amount: amt,
      category,
      reason,
      refundMethod,
      refundReference: refundMethod === 'bank_transfer' ? refundReference : undefined,
    })
    setBusy(false)
    if ('error' in r) { setError(r.error); return }
    setToast({ ok: true, message: 'Refund requested.' })
    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex m-anim-fade">
      <div
        className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
        onClick={onClose}
      />

      <aside
        style={{ width: '420px', maxWidth: '100%' }}
        className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">Refund this payment</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
          >
            Close
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--color-neutral-800)] mb-5">
          {payment.cycleName ? `${payment.cycleName} · ` : ''}Up to ₦{Math.round(payment.amount).toLocaleString('en-NG')} can be refunded on this payment.
          {payment.paidAt && ` Paid ${age(payment.paidAt)}.`}
        </p>

        <div className="border-t-2 border-[var(--color-ink)] pt-4">
          <label className="block mb-3.5">
            <span className="m-label">Amount (₦)</span>
            <input
              className="m-input m-num"
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
            />
          </label>

          <label className="block mb-3.5">
            <span className="m-label">Reason category</span>
            <Select value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
          </label>

          <label className="block mb-3.5">
            <span className="m-label">Explain the refund</span>
            <textarea
              className="m-textarea"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="At least 20 characters — this is kept in the audit log and may be shown to the approver."
            />
          </label>

          <label className="block mb-3.5">
            <span className="m-label">How the money goes back</span>
            <Select value={refundMethod} onChange={setRefundMethod} options={METHOD_OPTIONS} />
          </label>

          {refundMethod === 'bank_transfer' && (
            <label className="block mb-3.5">
              <span className="m-label">Reference (proof the transfer was made)</span>
              <input
                className="m-input"
                value={refundReference}
                onChange={e => setRefundReference(e.target.value)}
                placeholder="Your bank's transfer reference or receipt number"
              />
            </label>
          )}

          {error && (
            <div className="pl-3 text-sm mb-4" style={{ borderLeft: '3px solid var(--color-signal-text)', color: 'var(--color-signal-text)' }}>
              {error}
            </div>
          )}

          <div className="flex items-center gap-2.5 pt-2">
            <button onClick={submit} disabled={busy} className="m-btn m-btn-primary flex-1 min-w-[130px]">
              {busy ? 'Requesting...' : 'Request refund'}
            </button>
            <button type="button" onClick={onClose} className="m-btn m-btn-outline flex-1 min-w-[130px]">
              Cancel
            </button>
          </div>
        </div>
      </aside>

      {toast && <Toast message={toast.message} ok={toast.ok} onDismiss={() => setToast(null)} />}
    </div>
  )
}
