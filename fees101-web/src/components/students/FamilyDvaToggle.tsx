'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toggleFamilyDva } from '@/app/(app)/students/[id]/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'

interface Props {
  familyId: string
  dvaEnabled: boolean
  accountNumber: string | null
  bankName: string | null
}

// Opt-in family-level DVA (ROADMAP.md, 2026-09-27): one shared account for a
// family, alongside — not instead of — each sibling's own account. Every
// sibling's page renders this identically since it's the same family_id
// underneath. Turning it on provisions a real account at the provider;
// turning it off actually closes that account at the provider so it stops
// accepting transfers — not reversible, so it's confirmed the same way a
// student withdrawal is (see WithdrawConfirmModal / DestructiveConfirmModal).
export default function FamilyDvaToggle({ familyId, dvaEnabled, accountNumber, bankName }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmingOff, setConfirmingOff] = useState(false)
  const canManage = useCan('manage-students')

  async function handleToggle(next: boolean) {
    if (saving) return
    setSaving(true)
    setError(null)
    const result = await toggleFamilyDva(familyId, next)
    setSaving(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setConfirmingOff(false)
    router.refresh()
  }

  async function handleCopy() {
    if (!accountNumber) return
    await navigator.clipboard.writeText(accountNumber)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="m-panel">
      <h3 className="text-[18px] font-extrabold mb-1">Family virtual account</h3>
      <p className="text-[13px] text-[var(--color-neutral-800)] mb-3">
        A single shared account for this family, so a parent paying for every child can send one transfer instead of one per child.
      </p>

      <div className="flex items-center justify-between gap-3 py-2.5 border-t border-[var(--color-neutral-300)]">
        <span className="text-[13px] font-semibold text-[var(--color-ink)]">
          {dvaEnabled ? 'On' : 'Off'}
        </span>
        {canManage ? (
          <button
            onClick={() => (dvaEnabled ? setConfirmingOff(true) : handleToggle(true))}
            disabled={saving}
            className="m-btn m-btn-outline m-btn-sm whitespace-nowrap"
          >
            {saving && !dvaEnabled ? 'Setting up...' : dvaEnabled ? 'Turn off' : 'Turn on'}
          </button>
        ) : (
          <span className="text-[13px] text-[var(--color-neutral-700)]">Ask an admin to change this.</span>
        )}
      </div>

      {dvaEnabled && accountNumber && (
        <div className="pt-2.5">
          <p className="text-[22px] font-extrabold tracking-[0.02em] m-num text-[var(--color-ink)] mb-1">{accountNumber}</p>
          <p className="text-[13px] text-[var(--color-neutral-800)]">
            {bankName}
            <span className="text-[var(--color-neutral-400)]"> · </span>
            <button
              onClick={handleCopy}
              className="font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]"
            >
              {copied ? <span className="text-[var(--color-ink)]">copied</span> : 'copy'}
            </button>
          </p>
        </div>
      )}

      {error && (
        <p className="text-[13px] text-[var(--color-signal-text)] pt-2.5">{error}</p>
      )}

      {confirmingOff && (
        <DestructiveConfirmModal
          eyebrow="This closes the account"
          title="Turn off the family account"
          description="The account is closed at the bank, not just hidden here - it stops accepting transfers immediately. Any payment already made through it stays on record."
          rows={[
            { label: 'Account number', value: accountNumber || '—' },
            {
              label: 'After this',
              value: 'Transfers to it will fail',
              valueClassName: 'text-sm font-semibold m-num text-[var(--color-signal-text)]',
              emphasize: true,
            },
          ]}
          note="Turning it back on later creates a new account with a different number - this one doesn't come back."
          error={error}
          actions={[
            { label: 'Cancel', onClick: () => setConfirmingOff(false), variant: 'outline', disabled: saving },
            { label: saving ? 'Closing...' : 'Turn off', onClick: () => handleToggle(false), variant: 'danger', disabled: saving },
          ]}
        />
      )}
    </div>
  )
}
