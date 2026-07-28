'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { revokeRecurringDiscount } from '@/app/(app)/discounts/actions'
import type { ActiveRecurringDiscount } from '@/lib/queries/discountRequests'

const CATEGORY_LABELS: Record<string, string> = {
  staff_child: 'Staff-child discount',
  scholarship: 'Scholarship',
  bursary: 'Bursary',
  financial_hardship: 'Financial hardship',
  fee_waiver: 'Fee waiver',
  other: 'Other',
}

interface Props {
  discounts: ActiveRecurringDiscount[]
}

export default function ActiveRecurringDiscountsList({ discounts }: Props) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  async function handleRevoke(id: string) {
    setError(null)
    setPendingId(id)
    const result = await revokeRecurringDiscount(id)
    setPendingId(null)
    setConfirmId(null)
    if (result.error) return setError(result.error)
    router.refresh()
  }

  if (discounts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-500">No recurring discounts active</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {discounts.map(d => (
          <div key={d.id} className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/students/${d.studentId}`} className="text-sm font-semibold text-navy hover:text-mint">
                  {d.studentName}
                </Link>
                <span className="text-xs text-gray-400">{d.className}</span>
                <span className="text-xs px-2 py-0.5 bg-mint-light text-mint rounded-full font-medium">
                  {CATEGORY_LABELS[d.category] || d.category}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {d.isPercentage ? `${d.amount}%` : `₦${d.amount.toLocaleString('en-NG')}`} off every term
              </p>
            </div>

            {confirmId === d.id ? (
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-gray-500">Stop this discount from future invoices?</span>
                <button
                  onClick={() => setConfirmId(null)}
                  disabled={pendingId === d.id}
                  className="px-3 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRevoke(d.id)}
                  disabled={pendingId === d.id}
                  className="px-3 py-1.5 text-xs bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {pendingId === d.id ? 'Revoking...' : 'Confirm revoke'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmId(d.id)}
                className="px-3 py-1.5 text-xs text-red-700 border border-red-200 rounded-lg hover:bg-red-50 flex-shrink-0"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
