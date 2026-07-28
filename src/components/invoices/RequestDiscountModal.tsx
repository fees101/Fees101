'use client'

import { useState } from 'react'
import { requestDiscount, type ManualDiscountCategory } from '@/app/(app)/invoices/[id]/discountActions'

interface Props {
  invoiceId: string
  onClose: () => void
  onSuccess: () => void
}

const CATEGORY_OPTIONS: { value: ManualDiscountCategory, label: string }[] = [
  { value: 'staff_child', label: 'Staff-child discount' },
  { value: 'scholarship', label: 'Scholarship' },
  { value: 'bursary', label: 'Bursary' },
  { value: 'financial_hardship', label: 'Financial hardship' },
  { value: 'fee_waiver', label: 'Fee waiver' },
  { value: 'other', label: 'Other' },
]

export default function RequestDiscountModal({ invoiceId, onClose, onSuccess }: Props) {
  const [category, setCategory] = useState<ManualDiscountCategory>('staff_child')
  const [isPercentage, setIsPercentage] = useState(true)
  const [amount, setAmount] = useState<number>(50)
  const [isRecurring, setIsRecurring] = useState(true)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    setSaving(true)
    const result = await requestDiscount(invoiceId, { category, amount, isPercentage, isRecurring, reason })
    setSaving(false)
    if (result.error) return setError(result.error)
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="p-6">
          <h3 className="text-base font-semibold text-navy mb-2">Request a discount</h3>
          <p className="text-sm text-gray-600 mb-4">
            Needs approval from a school admin before it reduces this invoice&apos;s total.
          </p>

          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ManualDiscountCategory)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 mb-3"
          >
            {CATEGORY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <label className="block text-xs text-gray-500 mb-1">Amount</label>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            />
            <select
              value={isPercentage ? 'pct' : 'naira'}
              onChange={(e) => setIsPercentage(e.target.value === 'pct')}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            >
              <option value="pct">%</option>
              <option value="naira">₦</option>
            </select>
          </div>

          <label className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="rounded border-gray-300 text-mint focus:ring-mint/40"
            />
            <span className="text-sm text-navy">Recurring — carry forward to future terms automatically</span>
          </label>

          <label className="block text-xs text-gray-500 mb-1">Reason (min. 20 characters)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Child of teaching staff, approved per staff handbook..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 resize-none"
            autoFocus
          />

          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
          >
            {saving ? 'Submitting...' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  )
}
