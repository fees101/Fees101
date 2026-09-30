'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import RequestDiscountModal from '@/components/invoices/RequestDiscountModal'
import { revokeDiscount } from '@/app/(app)/students/[id]/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'
import Toast from '@/components/ui/Toast'
import type { DiscountSettings } from '@/lib/queries/discounts'

export interface RevocableDiscount {
  id: string
  category: string
  reason: string
  isRecurring: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  staff_child: 'Staff-child discount',
  scholarship: 'Scholarship',
  bursary: 'Bursary',
  financial_hardship: 'Financial hardship',
  fee_waiver: 'Fee waiver',
  other: 'Discount',
}

interface Props {
  currentInvoiceId: string | null
  currentInvoiceSubtotal?: number
  currentInvoiceDiscountAmount?: number
  discounts: RevocableDiscount[]
  canAddDiscount: boolean
  canFullyRevoke: boolean
  discountSettings: DiscountSettings
  autoApproveThreshold: number | null
}

export default function ApplyDiscountButton({ currentInvoiceId, currentInvoiceSubtotal, currentInvoiceDiscountAmount, discounts, canAddDiscount, canFullyRevoke, discountSettings, autoApproveThreshold }: Props) {
  const router = useRouter()
  const [manageOpen, setManageOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null)
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [toastResult, setToastResult] = useState<{ ok: boolean; message: string } | null>(null)
  const canRequest = useCan('request-discounts')
  const canApprove = useCan('approve-discounts')

  // Neither permission means nothing on this button is ever actionable,
  // regardless of the invoice/discount state below.
  if (!canRequest && !canApprove) return null

  if (!currentInvoiceId && discounts.length === 0) {
    return (
      <button
        disabled
        className="m-btn m-btn-outline w-full"
        title="Generate this term's invoice first"
      >
        Apply discount
      </button>
    )
  }

  const hasDiscounts = discounts.length > 0
  // Business logic (canAddDiscount) AND permission (canRequest) both have to
  // allow it before the "add a new discount" path is offered anywhere below.
  // Also needs a current invoice to attach the new request to — a student
  // with only an older invoice's discount to revoke can't add a new one here.
  const canOfferAdd = canAddDiscount && canRequest && !!currentInvoiceId

  function closeManage() {
    setManageOpen(false)
    setRevokeConfirmId(null)
    setRevokeError(null)
  }

  async function handleRevoke(id: string) {
    setRevoking(true)
    setRevokeError(null)
    const result = await revokeDiscount(id)
    setRevoking(false)
    if ('error' in result) { setRevokeError(result.error); setToastResult({ ok: false, message: result.error }); return }
    setRevokeConfirmId(null)
    setToastResult({ ok: true, message: 'Discount revoked.' })
    router.refresh()
  }

  // Adding is blocked only once a payment has landed — a parent can still
  // notice a missed discount and get it applied after the invoice was sent
  // but before they've paid anything. Fully revoking an existing discount
  // needs a firmer bar (sent OR paid) — see revokeDiscount server action.
  // With no discounts to fall back on viewing/revoking, this is also the
  // catch-all for a canApprove-only user who lacks request-discounts.
  if (!hasDiscounts && !canOfferAdd) {
    return (
      <button
        disabled
        className="m-btn m-btn-outline w-full"
        title={!canRequest ? 'You do not have permission to request discounts' : !currentInvoiceId ? 'Generate this term\'s invoice first' : 'This invoice already has a payment against it — discounts can no longer be applied'}
      >
        Apply discount
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => (hasDiscounts ? setManageOpen(true) : setRequestOpen(true))}
        className="m-btn m-btn-outline w-full"
      >
        {hasDiscounts ? 'Edit discount' : 'Apply discount'}
      </button>
      {submittedMessage && (
        <p className="text-xs" style={{ color: 'var(--color-ochre-text)' }}>{submittedMessage}</p>
      )}

      {/* Same drawer shell as RequestDiscountModal/FeeFormPanel: 420px
          right-edge aside, translucent backdrop, single scrolling p-[22px],
          header + uppercase-tracked signal-red Close, 2px ink field-stack rule. */}
      {manageOpen && (
        <div className="fixed inset-0 z-50 flex m-anim-fade">
          <div
            className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
            onClick={closeManage}
          />
          <aside
            style={{ width: '420px', maxWidth: '100%' }}
            className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">
                Discounts on this invoice
              </h2>
              <button
                onClick={closeManage}
                aria-label="Close"
                className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
              >
                Close
              </button>
            </div>
            <p className="text-[13px] leading-relaxed mb-5 text-[var(--color-neutral-700)]">
              What&apos;s reducing this invoice&apos;s total, and whether it can still be removed.
            </p>

            <div style={{ borderTop: '2px solid var(--color-ink)' }}>
              {discounts.map(d => {
                const canRevokeThis = d.isRecurring || canFullyRevoke
                const confirming = revokeConfirmId === d.id
                return (
                  <div key={d.id} style={{ borderBottom: '1px solid var(--color-neutral-300)', padding: '14px 0' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div style={{ minWidth: 0 }}>
                        <p className="text-[14px] font-semibold text-[var(--color-ink)]">{CATEGORY_LABELS[d.category] || d.category}</p>
                        <p className="text-[13px] text-[var(--color-neutral-700)] mt-0.5">{d.reason}</p>
                        {d.isRecurring && (
                          <p className="text-[12px] text-[var(--color-neutral-500)] mt-0.5">Recurring — carries forward each term</p>
                        )}
                      </div>
                      {canApprove && !confirming && (
                        <button
                          onClick={() => { setRevokeConfirmId(d.id); setRevokeError(null) }}
                          disabled={!canRevokeThis}
                          title={canRevokeThis ? undefined : 'This invoice has already been sent or paid against, so this discount can no longer be removed'}
                          className="text-[11px] font-semibold uppercase tracking-[0.06em] hover:underline disabled:opacity-40 disabled:no-underline shrink-0"
                          style={{ color: 'var(--color-signal-text)' }}
                        >
                          Revoke?
                        </button>
                      )}
                    </div>

                    {confirming && (
                      <div style={{ borderLeft: '2px solid var(--color-ink)', padding: '12px 0 2px 14px', marginTop: 10 }}>
                        <p className="text-[13px]" style={{ color: 'var(--color-ink)', marginBottom: 10 }}>
                          {canFullyRevoke
                            ? 'This invoice has not been sent or paid against yet, so this comes off it immediately and the invoice recomputes.'
                            : 'This invoice has already been sent or paid against, so it keeps its current total and history — this only stops the discount from applying to future invoices.'}
                        </p>
                        {revokeError && (
                          <p className="text-[13px]" style={{ color: 'var(--color-signal-text)', marginBottom: 10 }}>{revokeError}</p>
                        )}
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleRevoke(d.id)} disabled={revoking} className="m-btn m-btn-danger m-btn-sm">
                            {revoking ? 'Revoking...' : 'Revoke?'}
                          </button>
                          <button onClick={() => { setRevokeConfirmId(null); setRevokeError(null) }} disabled={revoking} className="text-[13px] font-semibold hover:underline disabled:opacity-40 disabled:no-underline" style={{ color: 'var(--color-ink)' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ marginTop: 18 }}>
              {canOfferAdd ? (
                <button
                  onClick={() => { setManageOpen(false); setRequestOpen(true) }}
                  className="m-btn m-btn-primary"
                  style={{ width: '100%' }}
                >
                  + Apply another discount
                </button>
              ) : (
                <p className="text-[12px] text-[var(--color-neutral-500)]">
                  {!canAddDiscount
                    ? 'Already has a payment — no new discounts can be applied'
                    : 'You do not have permission to request new discounts'}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      {requestOpen && currentInvoiceId && (
        <RequestDiscountModal
          invoiceId={currentInvoiceId}
          subtotal={currentInvoiceSubtotal ?? 0}
          existingDiscountAmount={currentInvoiceDiscountAmount ?? 0}
          discountSettings={discountSettings}
          autoApproveThreshold={autoApproveThreshold}
          onClose={() => setRequestOpen(false)}
          onSuccess={(autoApproved) => {
            setRequestOpen(false)
            setSubmittedMessage(autoApproved ? 'Discount granted — below the auto-approve threshold.' : 'Discount request submitted — awaiting admin approval')
            router.refresh()
          }}
        />
      )}

      {toastResult && (
        <Toast message={toastResult.message} ok={toastResult.ok} onDismiss={() => setToastResult(null)} />
      )}
    </div>
  )
}
