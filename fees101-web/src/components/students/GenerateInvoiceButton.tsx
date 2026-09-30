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

  // Hidden, not disabled, when the viewer lacks manage-invoices — matching
  // StudentFeesTab's own "Generate invoice" control for this identical
  // no-invoice-yet state (`canManageInvoices && !existingInvoice`). A missing
  // active cycle is a data-state reason, not a permission one, so that case
  // still shows the button disabled with an explanatory tooltip.
  if (!canManageInvoices) return null

  const disabled = !cycleId

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
        title={!cycleId ? 'No active billing cycle' : undefined}
        className="m-btn m-btn-primary"
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
