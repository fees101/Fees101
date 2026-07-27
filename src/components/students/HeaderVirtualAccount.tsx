'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createStudentDVA } from '@/app/(app)/students/[id]/actions'

interface Props {
  studentId: string
  providerConfigured: boolean
  hasAccount: boolean
  accountNumber: string | null
  bankName: string | null
}

// Compact virtual-account block for the student header. Mirrors the states in
// PaymentAccountCard (has account / can create / not configured) but sized to
// sit beside the student's name rather than as a full card in the payments tab.
export default function HeaderVirtualAccount({ studentId, providerConfigured, hasAccount, accountNumber, bankName }: Props) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
        <p className="text-xs text-gray-500 mb-1">Virtual account</p>
        <div className="flex items-center gap-2">
          <p className="text-2xl font-bold text-navy tracking-wide">{accountNumber}</p>
          <button
            onClick={handleCopy}
            className="px-2 py-1 text-xs font-medium text-navy border border-gray-200 rounded-md hover:bg-gray-50"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">{bankName}</p>
      </div>
    )
  }

  if (!providerConfigured) {
    return (
      <div>
        <p className="text-xs text-gray-500 mb-1">Virtual account</p>
        <p className="text-lg font-semibold text-gray-400">Not available</p>
        <p className="text-xs text-gray-500 mt-1">Online payments not set up for this school yet.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">Virtual account</p>
      <button
        onClick={handleCreate}
        disabled={creating}
        className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {creating ? 'Creating...' : 'Create account'}
      </button>
      <p className="text-xs text-gray-500 mt-1">So parents have an account to pay into.</p>
      {error && (
        <p className="text-xs text-red-600 mt-1 max-w-[200px]">{error}</p>
      )}
    </div>
  )
}
