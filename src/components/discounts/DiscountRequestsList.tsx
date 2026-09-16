'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { approveDiscount, rejectDiscount } from '@/app/(app)/discounts/actions'
import type { PendingDiscountRequest } from '@/lib/queries/discountRequests'
import { formatDate } from '@/lib/format/date'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

const CATEGORY_LABELS: Record<string, string> = {
  staff_child: 'Staff-child discount',
  scholarship: 'Scholarship',
  bursary: 'Bursary',
  financial_hardship: 'Financial hardship',
  fee_waiver: 'Fee waiver',
  other: 'Other',
}

// Mirrors RequestDiscountModal's threshold — surfaced again here since the
// approver may not be the person who requested it (2026-09-16 stress test:
// several individually-plausible discounts stacked to zero out a bill with
// no one warned at either step).
const CUMULATIVE_DISCOUNT_WARNING_THRESHOLD = 0.5

function projectedDiscountPercentage(req: PendingDiscountRequest): number | null {
  if (req.invoiceSubtotal <= 0) return null
  const thisAmount = req.isPercentage ? (req.invoiceSubtotal * req.amount) / 100 : req.amount
  const projected = Math.min(req.invoiceSubtotal, req.existingDiscountAmount + thisAmount)
  return (projected / req.invoiceSubtotal) * 100
}

interface Props {
  requests: PendingDiscountRequest[]
  // When false, approve/reject controls are hidden (see-discounts without
  // approve-discounts). The server actions enforce this regardless.
  canApprove: boolean
}

export default function DiscountRequestsList({ requests, canApprove }: Props) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejectDialog, setRejectDialog] = useState<PendingDiscountRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [approveDialog, setApproveDialog] = useState<PendingDiscountRequest | null>(null)

  async function handleApprove() {
    if (!approveDialog) return
    const id = approveDialog.id
    setError(null)
    setPendingId(id)
    const result = await approveDiscount(id)
    setPendingId(null)
    setApproveDialog(null)
    if (result.error) { setError(result.error); return }
    router.refresh()
  }

  async function handleReject() {
    if (!rejectDialog) return
    setError(null)
    setPendingId(rejectDialog.id)
    const result = await rejectDiscount(rejectDialog.id, rejectReason)
    setPendingId(null)
    if (result.error) return setError(result.error)
    setRejectDialog(null)
    setRejectReason('')
    router.refresh()
  }

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-sm text-gray-500">No pending discount requests</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {requests.map(req => (
          <div key={req.id} className="p-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/students/${req.studentId}`} className="text-sm font-semibold text-navy hover:text-mint">
                  {req.studentName}
                </Link>
                <span className="text-xs text-gray-400">{req.className}</span>
                <span className="text-xs px-2 py-0.5 bg-mint-light text-mint rounded-full font-medium">
                  {CATEGORY_LABELS[req.category] || req.category}
                </span>
                {req.isRecurring && (
                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">Recurring</span>
                )}
                {(() => {
                  const pct = projectedDiscountPercentage(req)
                  if (pct === null || pct / 100 < CUMULATIVE_DISCOUNT_WARNING_THRESHOLD) return null
                  return (
                    <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full font-medium">
                      ~{Math.round(pct)}% of subtotal cumulative
                    </span>
                  )
                })()}
              </div>
              <p className="text-sm text-navy font-medium mt-1.5">
                {req.isPercentage ? `${req.amount}%` : `₦${req.amount.toLocaleString('en-NG')}`} off — {req.cycleName}
              </p>
              <p className="text-sm text-gray-600 mt-1">{req.reason}</p>
              <p className="text-xs text-gray-400 mt-1.5">
                Requested by {req.requestedByName || 'unknown'} on {formatDate(req.requestedAt)}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                href={`/invoices/${req.invoiceId}`}
                className="px-3 py-1.5 text-xs text-navy border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                View invoice
              </Link>
              {canApprove && (
                <>
                  <button
                    onClick={() => setRejectDialog(req)}
                    disabled={pendingId === req.id}
                    className="px-3 py-1.5 text-xs text-red-700 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => setApproveDialog(req)}
                    disabled={pendingId === req.id}
                    className="px-3 py-1.5 text-xs bg-mint text-navy font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
                  >
                    {pendingId === req.id ? 'Approving...' : 'Approve'}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {rejectDialog && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-base font-semibold text-navy mb-2">
                Reject discount request for {rejectDialog.studentName}?
              </h3>
              <label className="block text-xs text-gray-500 mb-1">Reason for rejection</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 resize-none"
                autoFocus
              />
            </div>
            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                onClick={() => { setRejectDialog(null); setRejectReason('') }}
                disabled={pendingId === rejectDialog.id}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={pendingId === rejectDialog.id}
                className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {pendingId === rejectDialog.id ? 'Rejecting...' : 'Reject request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {approveDialog && (
        <ConfirmDialog
          title="Approve this discount?"
          message={(() => {
            const pct = projectedDiscountPercentage(approveDialog)
            if (pct !== null && pct / 100 >= CUMULATIVE_DISCOUNT_WARNING_THRESHOLD) {
              return `This will recompute the invoice immediately. Cumulative discounts on this invoice would reach ~${Math.round(pct)}% of the subtotal — worth double-checking before approving.`
            }
            return 'This will recompute the invoice immediately.'
          })()}
          confirmLabel={pendingId === approveDialog.id ? 'Approving...' : 'Approve'}
          onConfirm={handleApprove}
          onCancel={() => setApproveDialog(null)}
        />
      )}
    </div>
  )
}
