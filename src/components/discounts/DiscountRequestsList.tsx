'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { approveDiscount, rejectDiscount } from '@/app/(app)/discounts/actions'
import type { PendingDiscountRequest } from '@/lib/queries/discountRequests'

const CATEGORY_LABELS: Record<string, string> = {
  staff_child: 'Staff-child discount',
  scholarship: 'Scholarship',
  bursary: 'Bursary',
  financial_hardship: 'Financial hardship',
  fee_waiver: 'Fee waiver',
  other: 'Other',
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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

  async function handleApprove(id: string) {
    setError(null)
    setPendingId(id)
    const result = await approveDiscount(id)
    setPendingId(null)
    if (result.error) return setError(result.error)
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
                    onClick={() => handleApprove(req.id)}
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
    </div>
  )
}
