'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { reallocateFamilyCredit } from '@/app/(app)/students/[id]/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'
import Toast from '@/components/ui/Toast'
import Select from '@/components/ui/Select'

interface Sibling {
  id: string
  firstName: string
  lastName: string
  creditBalance: number
}

interface Props {
  studentId: string
  studentName: string
  studentCreditBalance: number
  siblings: Sibling[]
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

// Surfaces reallocateFamilyCredit (students/[id]/actions.ts) — a family DVA
// overpayment's overflow lands on one deterministic sibling, but a family
// occasionally meant it for someone else. Only shown when at least one
// student in the family (this one or a sibling) actually has credit to move,
// since with none there's nothing this panel could ever do.
export default function MoveFamilyCredit({ studentId, studentName, studentCreditBalance, siblings }: Props) {
  const router = useRouter()
  const canManage = useCan('manage-students')
  const [open, setOpen] = useState(false)
  const [fromId, setFromId] = useState<string>(studentCreditBalance > 0 ? studentId : (siblings.find(s => s.creditBalance > 0)?.id ?? studentId))
  const [toId, setToId] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const holders = [
    { id: studentId, name: studentName, creditBalance: studentCreditBalance },
    ...siblings.map(s => ({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), creditBalance: s.creditBalance })),
  ]
  const withCredit = holders.filter(h => h.creditBalance > 0)

  if (!canManage || withCredit.length === 0) return null

  const fromHolder = holders.find(h => h.id === fromId)
  const toOptions = holders.filter(h => h.id !== fromId)
  const enteredAmount = Number(amount) || 0
  const canSubmit = !!fromHolder && fromHolder.creditBalance > 0 && !!toId && enteredAmount > 0 && enteredAmount <= fromHolder.creditBalance

  function openModal() {
    setError(null)
    setAmount('')
    const defaultFrom = withCredit[0]?.id ?? studentId
    setFromId(defaultFrom)
    setToId(holders.find(h => h.id !== defaultFrom)?.id ?? '')
    setOpen(true)
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    const result = await reallocateFamilyCredit(fromId, toId, enteredAmount)
    setSaving(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setOpen(false)
    setToast(`Moved ${formatNaira(enteredAmount)} to ${holders.find(h => h.id === toId)?.name}.`)
    router.refresh()
  }

  return (
    <div>
      <button onClick={openModal} className="text-[13px] font-semibold underline text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]">
        Move credit between siblings
      </button>
      {toast && <Toast ok message={toast} onDismiss={() => setToast(null)} />}

      {open && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
          <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
            <div className="p-6">
              <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-2">Move credit</h3>
              <p className="text-sm text-[var(--color-neutral-700)] mb-4">
                Reallocate unapplied credit between siblings in this family — no invoice or payment record, just the balance moving from one child to another.
              </p>

              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)] block mb-1">From</label>
              <Select
                value={fromId}
                onChange={v => {
                  setFromId(v)
                  if (v === toId) setToId(holders.find(h => h.id !== v)?.id ?? '')
                }}
                className="w-full box-border mb-3"
                ariaLabel="From"
                options={holders.map(h => ({
                  value: h.id,
                  label: `${h.name} — ${formatNaira(h.creditBalance)} available`,
                  disabled: h.creditBalance <= 0,
                }))}
              />

              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)] block mb-1">To</label>
              <Select
                value={toId}
                onChange={setToId}
                className="w-full box-border mb-3"
                placeholder="Choose a sibling"
                ariaLabel="To"
                options={toOptions.map(h => ({ value: h.id, label: h.name }))}
              />

              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)] block mb-1">Amount</label>
              <input
                type="number"
                min="1"
                max={fromHolder?.creditBalance ?? undefined}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="m-input w-full box-border m-num"
              />

              {error && (
                <div className="mt-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
                  {error}
                </div>
              )}
            </div>
            <div className="p-6 border-t-2 border-[var(--color-ink)] flex flex-wrap items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={saving} className="m-btn m-btn-outline m-btn-sm">Cancel</button>
              <button onClick={handleSubmit} disabled={!canSubmit || saving} className="m-btn m-btn-primary m-btn-sm">
                {saving ? 'Moving...' : 'Move credit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
