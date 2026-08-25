'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import RequestDiscountModal from '@/components/invoices/RequestDiscountModal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { revokeDiscount } from '@/app/(app)/students/[id]/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'

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
  discounts: RevocableDiscount[]
  canAddDiscount: boolean
  canFullyRevoke: boolean
}

export default function ApplyDiscountButton({ currentInvoiceId, discounts, canAddDiscount, canFullyRevoke }: Props) {
  const router = useRouter()
  const [manageOpen, setManageOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<RevocableDiscount | null>(null)
  const canRequest = useCan('request-discounts')
  const canApprove = useCan('approve-discounts')

  // Neither permission means nothing on this button is ever actionable,
  // regardless of the invoice/discount state below.
  if (!canRequest && !canApprove) return null

  if (!currentInvoiceId) {
    return (
      <button
        disabled
        className="px-4 py-2 border border-mint text-mint rounded-lg text-sm font-medium flex items-center gap-2 opacity-50 cursor-not-allowed"
        title="Generate this term's invoice first"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        Apply discount
      </button>
    )
  }

  const hasDiscounts = discounts.length > 0
  // Business logic (canAddDiscount) AND permission (canRequest) both have to
  // allow it before the "add a new discount" path is offered anywhere below.
  const canOfferAdd = canAddDiscount && canRequest

  async function handleRevoke() {
    if (!revokeTarget) return
    const result = await revokeDiscount(revokeTarget.id)
    if ('error' in result) throw new Error(result.error)
    setRevokeTarget(null)
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
        className="px-4 py-2 border border-mint text-mint rounded-lg text-sm font-medium flex items-center gap-2 opacity-50 cursor-not-allowed"
        title={!canAddDiscount ? 'This invoice already has a payment against it — discounts can no longer be applied' : 'You do not have permission to request discounts'}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        Apply discount
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => (hasDiscounts ? setManageOpen(true) : setRequestOpen(true))}
        className="px-4 py-2 border border-mint text-mint rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-mint-light"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        {hasDiscounts ? 'Edit discount' : 'Apply discount'}
      </button>
      {submitted && (
        <p className="text-xs text-mint">Discount request submitted — awaiting admin approval</p>
      )}

      {manageOpen && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-base font-semibold text-navy mb-4">Discounts on this invoice</h3>
              <ul className="flex flex-col gap-3">
                {discounts.map(d => {
                  const canRevokeThis = d.isRecurring || canFullyRevoke
                  return (
                    <li key={d.id} className="flex items-start justify-between gap-3 p-3 border border-gray-200 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-navy">{CATEGORY_LABELS[d.category] || d.category}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{d.reason}</p>
                        {d.isRecurring && (
                          <p className="text-xs text-gray-400 mt-0.5">Recurring — carries forward each term</p>
                        )}
                      </div>
                      {canApprove && (
                        <button
                          onClick={() => setRevokeTarget(d)}
                          disabled={!canRevokeThis}
                          title={canRevokeThis ? undefined : 'This invoice has already been sent or paid against, so this discount can no longer be removed'}
                          className="shrink-0 px-2 py-1 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          Revoke
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="p-4 border-t border-gray-100 flex items-center justify-between">
              {canOfferAdd ? (
                <button
                  onClick={() => { setManageOpen(false); setRequestOpen(true) }}
                  className="px-3 py-2 text-sm font-medium text-mint hover:bg-mint-light rounded-lg"
                >
                  + Apply another discount
                </button>
              ) : (
                <p className="text-xs text-gray-400 max-w-[220px]">
                  {!canAddDiscount
                    ? 'Already has a payment — no new discounts can be applied'
                    : 'You do not have permission to request new discounts'}
                </p>
              )}
              <button
                onClick={() => setManageOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {revokeTarget && (
        <ConfirmDialog
          title={`Revoke ${CATEGORY_LABELS[revokeTarget.category] || revokeTarget.category}?`}
          message={
            canFullyRevoke
              ? 'This invoice has not been sent or paid against yet, so this will remove the discount from it immediately and recalculate the total.'
              : 'This invoice has already been sent or paid against, so it will keep its current total and history. This will only stop the discount from applying to future invoices.'
          }
          confirmLabel="Revoke"
          onConfirm={handleRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}

      {requestOpen && (
        <RequestDiscountModal
          invoiceId={currentInvoiceId}
          onClose={() => setRequestOpen(false)}
          onSuccess={() => {
            setRequestOpen(false)
            setSubmitted(true)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
