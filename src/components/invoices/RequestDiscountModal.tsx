'use client'

import { useState } from 'react'
import { requestDiscount, type ManualDiscountCategory } from '@/app/(app)/money/invoices/[id]/discountActions'
import type { DiscountSettings } from '@/lib/queries/discounts'

interface Props {
  invoiceId: string
  subtotal: number
  existingDiscountAmount: number
  // Current Discount policy — only staff_child's rate is read from here (a
  // fixed, school-wide benefit); every other category is still a free input
  // below, since a scholarship or hardship discount legitimately varies by
  // student and circumstance.
  discountSettings: DiscountSettings
  // Naira amount at/below which this request is granted instantly with no
  // approval wait, from the same settings page; null = always waits.
  autoApproveThreshold: number | null
  onClose: () => void
  onSuccess: (autoApproved: boolean) => void
}

const CATEGORY_OPTIONS: { value: ManualDiscountCategory, label: string }[] = [
  { value: 'staff_child', label: 'Staff-child discount' },
  { value: 'scholarship', label: 'Scholarship' },
  { value: 'bursary', label: 'Bursary' },
  { value: 'financial_hardship', label: 'Financial hardship' },
  { value: 'fee_waiver', label: 'Fee waiver' },
  { value: 'other', label: 'Other' },
]

// Stacking several individually-reasonable discounts can still zero out a
// bill in aggregate with no one having decided that outright (2026-09-16
// stress test) — this is a heads-up for the approver, not a cap: a genuine
// full-ride scholarship should still be approvable.
const CUMULATIVE_DISCOUNT_WARNING_THRESHOLD = 0.5

// Paper-ground palette, matching FeeFormPanel/CreateTermPanel's slide-over shell.
const INK = '#201e1d'
const META = '#605d5d'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, letterSpacing: '0.1em', color: INK, fontWeight: 600, textTransform: 'uppercase', margin: '0 0 6px' }}>
      {children}
    </p>
  )
}

export default function RequestDiscountModal({ invoiceId, subtotal, existingDiscountAmount, discountSettings, autoApproveThreshold, onClose, onSuccess }: Props) {
  const [category, setCategory] = useState<ManualDiscountCategory>('staff_child')
  const [amount, setAmount] = useState('')
  const [isPercentage, setIsPercentage] = useState(true)
  const [isRecurring, setIsRecurring] = useState(true)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isStaff = category === 'staff_child'
  // Staff-child's rate is fixed by policy — read-only here, same idea as the
  // full-invoice-vs-discountable scope choice, which is set on the Discount
  // policy page, not per request.
  const staffPct = discountSettings.staffDiscountDefaultPct
  const staffConfigured = staffPct > 0
  const staffScopeLabel = discountSettings.staffDiscountScope === 'full_invoice'
    ? 'the full invoice'
    : 'discountable fees only'

  const enteredAmount = Number(amount) || 0
  const thisRequestAmount = isStaff
    ? (subtotal * staffPct) / 100
    : (isPercentage ? (subtotal * enteredAmount) / 100 : enteredAmount)
  const projectedCumulative = Math.min(subtotal, existingDiscountAmount + thisRequestAmount)
  const projectedPercentage = subtotal > 0 ? (projectedCumulative / subtotal) * 100 : 0
  const canSubmit = isStaff ? staffConfigured : enteredAmount > 0
  const showStackingWarning = canSubmit && subtotal > 0 && projectedPercentage / 100 >= CUMULATIVE_DISCOUNT_WARNING_THRESHOLD

  async function handleSubmit() {
    setError(null)
    setSaving(true)
    const result = await requestDiscount(invoiceId, isStaff
      ? { category, reason }
      : { category, amount: enteredAmount, isPercentage, isRecurring, reason })
    setSaving(false)
    if (result.error) return setError(result.error)
    onSuccess(!!result.autoApproved)
  }

  return (
    <div className="fixed inset-0 z-50 flex m-anim-fade">
      <div
        className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
        onClick={onClose}
      />

      {/* Same shell as FeeFormPanel/CreateTermPanel: 420px, single p-[22px]
          scroll (header, fields and footer all scroll together). */}
      <aside
        style={{ width: '420px', maxWidth: '100%' }}
        className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em]" style={{ color: INK }}>
            Request a discount
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
          >
            Close
          </button>
        </div>
        <p className="text-[13px] leading-relaxed mb-5" style={{ color: META }}>
          {autoApproveThreshold !== null
            ? `Needs approval unless it's ₦${autoApproveThreshold.toLocaleString('en-NG')} or less, which is granted right away.`
            : "Needs approval from a school admin before it reduces this invoice's total."}
        </p>

        {/* The 2px ink rule opens the field stack (matches the canvas). */}
        <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 16 }}>

          <div style={{ marginBottom: 18 }}>
            <SectionLabel>Category</SectionLabel>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ManualDiscountCategory)}
              className="m-select"
            >
              {CATEGORY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {isStaff ? (
            // Read-only — staff-child's rate and scope are fixed by Discount
            // policy, the same benefit for any staff member's child.
            <div style={{ marginBottom: 18 }}>
              <SectionLabel>Applies</SectionLabel>
              <div style={{ border: `2px solid ${INK}`, background: '#fff', padding: '11px 14px' }}>
                {!staffConfigured ? (
                  <p className="text-[13px]" style={{ color: 'var(--color-signal-text)', margin: 0 }}>
                    No staff-child discount percentage is configured yet — set one on the Discount policy page first.
                  </p>
                ) : (
                  <>
                    <p className="text-[14px]" style={{ color: INK, fontWeight: 600, margin: 0 }}>
                      {staffPct}% off {staffScopeLabel}
                    </p>
                    <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>
                      Recurring — carries forward to future terms automatically.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 18 }}>
                <SectionLabel>Amount</SectionLabel>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={isPercentage ? 'e.g. 20' : 'e.g. 5000'}
                    className="m-input"
                    style={{ flex: 1 }}
                  />
                  <select
                    value={isPercentage ? 'pct' : 'flat'}
                    onChange={(e) => setIsPercentage(e.target.value === 'pct')}
                    className="m-select"
                    style={{ width: 90 }}
                  >
                    <option value="pct">%</option>
                    <option value="flat">₦</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3" style={{ marginBottom: 18 }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isRecurring}
                  aria-label="Recurring — carries forward to future terms automatically"
                  onClick={() => setIsRecurring(!isRecurring)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center border-2 transition-colors ${
                    isRecurring ? 'bg-[var(--color-ink)] border-[var(--color-ink)]' : 'bg-transparent border-[var(--color-neutral-400)]'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform transition-transform ${
                      isRecurring ? 'translate-x-[18px] bg-[var(--color-paper)]' : 'translate-x-0.5 bg-[var(--color-neutral-500)]'
                    }`}
                  />
                </button>
                <span className="text-[13px]" style={{ color: INK }}>Recurring — carries forward to future terms automatically</span>
              </div>
            </>
          )}

          <div style={{ marginBottom: 18 }}>
            <SectionLabel>Reason (min. 20 characters)</SectionLabel>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Child of teaching staff, approved per staff handbook..."
              rows={3}
              className="m-textarea"
              autoFocus
            />
          </div>

          {showStackingWarning && (
            <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--color-ochre)', marginBottom: 18 }}>
              <p className="text-[12px]" style={{ color: 'var(--color-ochre-text)' }}>
                {existingDiscountAmount > 0 ? (
                  <>With this request, cumulative discounts on this invoice would reach ~{Math.round(projectedPercentage)}% of the subtotal. Worth a second look before approving.</>
                ) : (
                  <>This request alone is ~{Math.round(projectedPercentage)}% of the subtotal. Worth a second look before approving.</>
                )}
              </p>
            </div>
          )}

          {error && (
            <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--color-signal)', marginBottom: 18 }}>
              <p className="text-[13px]" style={{ color: 'var(--color-signal-text)' }}>{error}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleSubmit} disabled={saving || reason.trim().length < 20 || !canSubmit} className="m-btn m-btn-primary" style={{ flex: 1 }}>
              {saving ? 'Submitting...' : 'Submit request'}
            </button>
            <button onClick={onClose} disabled={saving} className="m-btn m-btn-outline">
              Cancel
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
