'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { generateInvoiceForStudent } from '@/app/(app)/fees/cycles/actions'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useCan } from '@/lib/auth/PermissionsProvider'

interface Props {
  studentId: string
  studentName: string
  cycleId: string | null
}

export default function GenerateInvoiceButton({ studentId, studentName, cycleId }: Props) {
  const router = useRouter()
  const canManageInvoices = useCan('manage-invoices')
  const [confirming, setConfirming] = useState(false)

  const disabled = !canManageInvoices || !cycleId

  async function handleGenerate() {
    if (!cycleId) return
    const result = await generateInvoiceForStudent(studentId, cycleId)
    if ('error' in result && result.error) {
      throw new Error(result.error)
    }
    setConfirming(false)
    router.refresh()
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={disabled}
        title={!cycleId ? 'No active billing cycle' : !canManageInvoices ? 'You do not have permission to generate invoices' : undefined}
        className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Generate invoice
      </button>
      {confirming && (
        <ConfirmDialog
          title={`Generate invoice for ${studentName}?`}
          message="An invoice will be created using current fees, opt-ins, and exemptions."
          confirmLabel="Generate"
          onConfirm={handleGenerate}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
