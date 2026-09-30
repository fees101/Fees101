'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createStudentDVA } from '@/app/(app)/students/[id]/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'

interface Props {
  studentId: string
  providerConfigured: boolean
  hasAccount: boolean
  accountNumber: string | null
  bankName: string | null
}

// The identity header's "VIRTUAL ACCOUNT" column (App Shell showStudent):
// an 11px/0.16em label, the account number at 22px/800 tabular, then
// "<bank> · copy". Mirrors the states in PaymentAccountCard (has account /
// can create / not configured).
const LABEL = 'text-[11px] tracking-[0.16em] text-[var(--color-neutral-700)] mb-2'

export default function HeaderVirtualAccount({ studentId, providerConfigured, hasAccount, accountNumber, bankName }: Props) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const canCreate = useCan('manage-students')

  async function handleCreate() {
    if (creating || hasAccount) return
    setCreating(true)
    setError(null)
    const result = await createStudentDVA(studentId)
    setCreating(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  async function handleCopy() {
    if (!accountNumber) return
    await navigator.clipboard.writeText(accountNumber)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (hasAccount) {
    return (
      <div>
        <p className={LABEL}>VIRTUAL ACCOUNT</p>
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
    )
  }

  if (!providerConfigured) {
    return (
      <div>
        <p className={LABEL}>VIRTUAL ACCOUNT</p>
        <p className="text-[18px] font-semibold text-[var(--color-neutral-500)] mb-1">Not available</p>
        <p className="text-[13px] text-[var(--color-neutral-700)]">Online payments not set up for this school yet.</p>
      </div>
    )
  }

  if (!canCreate) {
    return (
      <div>
        <p className={LABEL}>VIRTUAL ACCOUNT</p>
        <p className="text-[18px] font-semibold text-[var(--color-neutral-500)] mb-1">Not set up yet</p>
        <p className="text-[13px] text-[var(--color-neutral-700)]">Ask an admin to set one up.</p>
      </div>
    )
  }

  return (
    <div>
      <p className={LABEL}>VIRTUAL ACCOUNT</p>
      <button
        onClick={handleCreate}
        disabled={creating}
        className="m-btn m-btn-primary m-btn-sm whitespace-nowrap"
      >
        {creating ? 'Creating...' : 'Create account'}
      </button>
      <p className="text-[13px] text-[var(--color-neutral-700)] mt-2">So parents have an account to pay into.</p>
      {error && (
        <p className="text-[13px] text-[var(--color-signal-text)] mt-1 max-w-[200px]">{error}</p>
      )}
    </div>
  )
}
