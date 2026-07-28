'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveDiscountSettings } from '@/app/(app)/settings/discounts/actions'
import type { DiscountSettings, SiblingTier } from '@/lib/queries/discounts'

interface Props {
  settings: DiscountSettings
}

function tierLabel(index: number): string {
  const ordinals = ['2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']
  return `${ordinals[index] || `${index + 2}th`} child`
}

export default function DiscountSettingsForm({ settings }: Props) {
  const router = useRouter()

  const [siblingTiers, setSiblingTiers] = useState<SiblingTier[]>(
    settings.siblingTiers.length ? settings.siblingTiers : [{ value: 10, isPercentage: true }]
  )
  const [staffDiscountDefaultPct, setStaffDiscountDefaultPct] = useState(settings.staffDiscountDefaultPct)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const inputCls = "w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-mint/40"
  const rowCls = "flex items-center justify-between gap-4 py-3"

  function updateTier(index: number, patch: Partial<SiblingTier>) {
    const next = [...siblingTiers]
    next[index] = { ...next[index], ...patch }
    setSiblingTiers(next)
    setSaved(false)
  }

  function addTier() {
    const last = siblingTiers[siblingTiers.length - 1]
    setSiblingTiers([...siblingTiers, { value: last ? last.value : 10, isPercentage: true }])
    setSaved(false)
  }

  function removeTier(index: number) {
    setSiblingTiers(siblingTiers.filter((_, i) => i !== index))
    setSaved(false)
  }

  async function handleSave() {
    setError(null)
    setSaved(false)
    setSaving(true)

    const result = await saveDiscountSettings({ siblingTiers, staffDiscountDefaultPct })

    setSaving(false)
    if (result.error) return setError(result.error)

    setSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="pb-3 border-b border-gray-100">
          <h2 className="text-navy font-semibold text-lg">Sibling discount</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Applied automatically at invoice generation when siblings (same family) are enrolled in the same term.
            The oldest enrolled child is always full price; add a % tier for each additional child.
          </p>
        </div>

        {siblingTiers.map((tier, i) => (
          <div key={i} className={rowCls}>
            <span className="text-sm text-navy font-medium">{tierLabel(i)}</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={tier.value}
                onChange={(e) => updateTier(i, { value: Number(e.target.value) })}
                className={inputCls}
              />
              <span className="text-sm text-gray-500">% off</span>
              <button
                type="button"
                onClick={() => removeTier(i)}
                className="text-gray-400 hover:text-red-600 p-1"
                aria-label="Remove tier"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addTier}
          className="mt-1 text-sm text-mint font-medium hover:underline flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add another tier
        </button>

        <div className={`${rowCls} border-t border-gray-100 mt-4 pt-4`}>
          <div>
            <p className="text-sm text-navy font-medium">Staff-child discount default</p>
            <p className="text-xs text-gray-500">Suggested % when requesting a staff discount — still adjustable per request</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={staffDiscountDefaultPct}
              onChange={(e) => { setStaffDiscountDefaultPct(Number(e.target.value)); setSaved(false) }}
              className={inputCls}
            />
            <span className="text-sm text-gray-500">% off</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save settings'}
          </button>
          {saved && (
            <span className="text-sm text-mint font-medium flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
