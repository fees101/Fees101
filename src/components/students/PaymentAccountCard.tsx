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

export default function PaymentAccountCard({ studentId, providerConfigured, hasAccount, accountNumber, bankName }: Props) {
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

  // School hasn't set up a payment provider — nothing actionable here, just say so quietly.
  if (!providerConfigured) {
    return (
      <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 flex items-center gap-3">
        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-gray-500">Online payments not set up for this school yet.</p>
      </div>
    )
  }

  // Has a live virtual account — show it.
  if (hasAccount) {
    return (
      <div className="bg-white p-5 rounded-xl border border-gray-200">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Payment account</p>
              <p className="text-lg font-bold text-navy tracking-wide">{accountNumber}</p>
              <p className="text-xs text-gray-500 mt-0.5">{bankName}</p>
            </div>
          </div>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-xs font-medium text-navy border border-gray-200 rounded-lg hover:bg-gray-50 flex-shrink-0"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">Parents can transfer to this account to pay fees.</p>
      </div>
    )
  }

  // Provider is configured but this student doesn't have an account yet.
  return (
    <div className="bg-white p-5 rounded-xl border border-gray-200">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium text-navy">No payment account yet</p>
          <p className="text-xs text-gray-500 mt-0.5">Create one so parents have an account to transfer fees into.</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {creating ? 'Creating...' : 'Create payment account'}
        </button>
      </div>
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
