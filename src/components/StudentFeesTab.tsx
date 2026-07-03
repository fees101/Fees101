'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { StudentFeesData, StudentFeeItem } from '@/lib/queries/students'
import { 
  toggleStudentOptIn, 
  setStudentExemption, 
  removeStudentExemption 
} from '@/app/(app)/students/[id]/actions'
import { 
  previewInvoiceForStudent, 
  generateInvoiceForStudent, 
  regenerateInvoice 
} from '@/app/(app)/fees/cycles/actions'
import ConfirmDialog from '@/components/ConfirmDialog'

interface Props {
  data: StudentFeesData
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

interface PreviewState {
  cycleName: string
  lineItems: Array<{ name: string, amount: number, kind?: string }>
  subtotal: number
  previousBalance: number
  total: number
}

export default function StudentFeesTab({ data }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [exemptionDialog, setExemptionDialog] = useState<{
    fee: StudentFeeItem
    notes: string
  } | null>(null)
  const [removeExemptionConfirm, setRemoveExemptionConfirm] = useState<StudentFeeItem | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewState | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateConfirm, setGenerateConfirm] = useState(false)
  const [updateConfirm, setUpdateConfirm] = useState(false)

  if (!data.cycle) {
    return (
      <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
        <p className="text-gray-500 mb-2">No active billing cycle.</p>
        <p className="text-sm text-gray-400">Create a term first to manage fees for this student.</p>
      </div>
    )
  }

  if (data.requiredFees.length === 0 && data.optionalFees.length === 0) {
    return (
      <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
        <p className="text-gray-500 mb-2">No fees set up for {data.student.className} yet.</p>
        <Link href="/fees/structure" className="text-sm text-mint font-medium hover:underline">
          Go to Fee Structure →
        </Link>
      </div>
    )
  }

  // Smart button state
  const existingInvoice = data.existingInvoice
  const isInvoiceUpToDate = existingInvoice && existingInvoice.totalAmount === data.expectedBill
  const diffAmount = existingInvoice ? data.expectedBill - existingInvoice.totalAmount : 0
  const newOutstanding = existingInvoice ? data.expectedBill - existingInvoice.paidAmount : 0

  async function handleToggleOptIn(fee: StudentFeeItem) {
    setError(null)
    setPendingId(fee.id)
    const result = await toggleStudentOptIn(data.student.id, fee.id)
    if ('error' in result && result.error) {
      setError(result.error)
    } else {
      router.refresh()
    }
    setPendingId(null)
  }

  async function handleConfirmExemption() {
    if (!exemptionDialog) return
    setError(null)
    setPendingId(exemptionDialog.fee.id)
    const result = await setStudentExemption(
      data.student.id,
      exemptionDialog.fee.id,
      exemptionDialog.notes
    )
    if ('error' in result && result.error) {
      setError(result.error)
    } else {
      router.refresh()
    }
    setExemptionDialog(null)
    setPendingId(null)
  }

  async function handleRemoveExemption() {
    if (!removeExemptionConfirm) return
    setError(null)
    setPendingId(removeExemptionConfirm.id)
    const result = await removeStudentExemption(data.student.id, removeExemptionConfirm.id)
    if ('error' in result && result.error) {
      setError(result.error)
    } else {
      router.refresh()
    }
    setRemoveExemptionConfirm(null)
    setPendingId(null)
  }

  async function handlePreview() {
    setError(null)
    setPreviewing(true)
    const result = await previewInvoiceForStudent(data.student.id)
    if ('error' in result && result.error) {
      setError(result.error)
    } else if (!('error' in result)) {
      setPreviewData({
        cycleName: result.cycleName,
        lineItems: result.preview.lineItems,
        subtotal: result.preview.subtotal,
        previousBalance: result.preview.previousBalance,
        total: result.preview.total,
      })
    }
    setPreviewing(false)
  }

  async function handleGenerateInvoice() {
    setError(null)
    setGenerating(true)
    const result = await generateInvoiceForStudent(data.student.id)
    if ('error' in result && result.error) {
      setError(result.error)
    } else {
      router.refresh()
    }
    setGenerating(false)
    setGenerateConfirm(false)
  }

  async function handleUpdateInvoice() {
    if (!existingInvoice) return
    setError(null)
    setGenerating(true)
    const result = await regenerateInvoice(existingInvoice.id)
    if ('error' in result && result.error) {
      setError(result.error)
    } else {
      router.refresh()
    }
    setGenerating(false)
    setUpdateConfirm(false)
  }

  return (
    <>
      <div className="space-y-6">

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-navy font-semibold text-lg">{data.cycle.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Fees that apply to this student for this term
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {previewing ? 'Loading...' : 'Preview invoice'}
            </button>
            {!existingInvoice && (
              <button
                onClick={() => setGenerateConfirm(true)}
                disabled={generating}
                className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
              >
                Generate invoice
              </button>
            )}
            {existingInvoice && !isInvoiceUpToDate && (
              <button
                onClick={() => setUpdateConfirm(true)}
                disabled={generating}
                className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50"
              >
                Update invoice
              </button>
            )}
            {existingInvoice && isInvoiceUpToDate && (
              <span className="px-3 py-2 text-sm text-gray-500 italic">
                Invoice up to date
              </span>
            )}
          </div>
        </div>

        {/* Existing invoice info */}
        {existingInvoice && (
          <div className={`p-4 rounded-xl border ${
            isInvoiceUpToDate 
              ? 'bg-mint-light/30 border-mint/30' 
              : 'bg-amber-50 border-amber-200'
          }`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Current invoice</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-semibold text-navy">
                    Total: {formatNaira(existingInvoice.totalAmount)}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="text-sm text-mint">
                    Paid: {formatNaira(existingInvoice.paidAmount)}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className={`text-sm font-medium ${existingInvoice.outstandingAmount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                    Outstanding: {formatNaira(existingInvoice.outstandingAmount)}
                  </span>
                  {existingInvoice.needsResend && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                        needs resend
                      </span>
                    </>
                  )}
                </div>
                {!isInvoiceUpToDate && (
                  <p className="text-xs text-amber-700 mt-2">
                    Adjustments have been made. Current invoice ({formatNaira(existingInvoice.totalAmount)}) 
                    differs from expected ({formatNaira(data.expectedBill)}). 
                    Click &quot;Update invoice&quot; to apply.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Required fees */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-navy font-semibold">Required fees</h3>
            <p className="text-xs text-gray-500">
              Auto-applied to all students in {data.student.className}
            </p>
          </div>

          {data.requiredFees.length === 0 ? (
            <p className="text-gray-500 text-sm py-6 text-center">No required fees for this class.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Item</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Amount</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Status</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.requiredFees.map(fee => (
                  <tr key={fee.id} className={fee.isExempted ? 'opacity-60' : ''}>
                    <td className="py-3">
                      <span className={`text-sm text-navy ${fee.isExempted ? 'line-through' : ''}`}>
                        {fee.name}
                      </span>
                      {fee.isSchoolWide && (
                        <span className="ml-2 text-xs text-gray-500">(school-wide)</span>
                      )}
                      {fee.isExempted && fee.exemptionNotes && (
                        <p className="text-xs text-amber-700 mt-0.5">Note: {fee.exemptionNotes}</p>
                      )}
                    </td>
                    <td className={`py-3 text-sm text-right ${fee.isExempted ? 'line-through text-gray-400' : 'text-navy font-medium'}`}>
                      {formatNaira(fee.amount)}
                    </td>
                    <td className="py-3 text-right">
                      {fee.isExempted ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-full">
                          Exempted
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">Applied</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {fee.isExempted ? (
                        <button
                          onClick={() => setRemoveExemptionConfirm(fee)}
                          disabled={pendingId === fee.id}
                          className="text-xs text-mint font-medium hover:underline disabled:opacity-50"
                        >
                          Remove exemption
                        </button>
                      ) : (
                        <button
                          onClick={() => setExemptionDialog({ fee, notes: '' })}
                          disabled={pendingId === fee.id}
                          className="text-xs text-gray-600 font-medium hover:underline disabled:opacity-50"
                        >
                          Mark as exempt
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200">
                <tr>
                  <td className="py-3 text-sm font-bold text-navy">Required total</td>
                  <td className="py-3 text-sm font-bold text-right text-navy">
                    {formatNaira(data.requiredTotal)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
                {data.exemptionTotal > 0 && (
                  <tr>
                    <td className="py-1 text-xs text-amber-700">Less exemptions</td>
                    <td className="py-1 text-xs text-right text-amber-700">
                      -{formatNaira(data.exemptionTotal)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>

        {/* Optional fees */}
        {data.optionalFees.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-navy font-semibold">Optional fees</h3>
              <p className="text-xs text-gray-500">
                Tick to opt this student in
              </p>
            </div>

            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2 w-12"></th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Item</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Amount</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.optionalFees.map(fee => (
                  <tr key={fee.id}>
                    <td className="py-3">
                      <input
                        type="checkbox"
                        checked={fee.isOptedIn}
                        disabled={pendingId === fee.id}
                        onChange={() => handleToggleOptIn(fee)}
                        className="text-mint cursor-pointer disabled:opacity-50"
                      />
                    </td>
                    <td className="py-3">
                      <span className="text-sm text-navy">{fee.name}</span>
                      {fee.isSchoolWide && (
                        <span className="ml-2 text-xs text-gray-500">(school-wide)</span>
                      )}
                    </td>
                    <td className={`py-3 text-sm text-right ${fee.isOptedIn ? 'text-navy font-medium' : 'text-gray-400'}`}>
                      {formatNaira(fee.amount)}
                    </td>
                    <td className="py-3 text-right">
                      {fee.isOptedIn ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-mint-light text-mint rounded-full">
                          Opted in
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Not opted in</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200">
                <tr>
                  <td></td>
                  <td className="py-3 text-sm font-bold text-navy">Opt-in total</td>
                  <td className="py-3 text-sm font-bold text-right text-navy">
                    +{formatNaira(data.optInTotal)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Expected bill */}
        <div className="bg-mint-light/40 border border-mint/30 rounded-xl p-6">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Expected bill this term</p>
              <p className="text-xs text-gray-500">
                Required ({formatNaira(data.requiredTotal)})
                {data.exemptionTotal > 0 && ` − Exemptions (${formatNaira(data.exemptionTotal)})`}
                {data.optInTotal > 0 && ` + Opt-ins (${formatNaira(data.optInTotal)})`}
              </p>
            </div>
            <p className="text-3xl font-bold text-navy">{formatNaira(data.expectedBill)}</p>
          </div>
        </div>
      </div>

      {/* Exemption dialog */}
      {exemptionDialog && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-base font-semibold text-navy mb-2">
                Exempt from &quot;{exemptionDialog.fee.name}&quot;?
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                {data.student.firstName} {data.student.lastName} won&apos;t be charged {formatNaira(exemptionDialog.fee.amount)} for this fee.
              </p>

              <label className="block text-xs text-gray-500 mb-1">Reason (optional)</label>
              <textarea
                value={exemptionDialog.notes}
                onChange={(e) => setExemptionDialog({ ...exemptionDialog, notes: e.target.value })}
                placeholder="e.g. Scholarship, staff child, sibling discount..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 resize-none"
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">Helpful for record-keeping later</p>
            </div>

            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setExemptionDialog(null)}
                disabled={pendingId === exemptionDialog.fee.id}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmExemption}
                disabled={pendingId === exemptionDialog.fee.id}
                className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
              >
                {pendingId === exemptionDialog.fee.id ? 'Saving...' : 'Confirm exemption'}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeExemptionConfirm && (
        <ConfirmDialog
          title={`Remove exemption for "${removeExemptionConfirm.name}"?`}
          message={`${data.student.firstName} ${data.student.lastName} will be charged ${formatNaira(removeExemptionConfirm.amount)} for this fee again.`}
          confirmLabel="Remove exemption"
          onConfirm={handleRemoveExemption}
          onCancel={() => setRemoveExemptionConfirm(null)}
        />
      )}

      {/* Preview modal */}
      {previewData && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-navy">Invoice preview</h3>
                <p className="text-xs text-gray-500 mt-0.5">{previewData.cycleName}</p>
              </div>
              <button onClick={() => setPreviewData(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-gray-700 mb-3">
                <strong>{data.student.firstName} {data.student.lastName}</strong> · {data.student.className}
              </p>
              <table className="w-full text-sm mb-4">
                <tbody className="divide-y divide-gray-100">
                  {previewData.lineItems.map((li, idx) => (
                    <tr key={idx}>
                      <td className="py-2">
                        {li.name}
                        {li.kind === 'opt_in' && (
                          <span className="ml-2 text-xs text-gray-500">(opt-in)</span>
                        )}
                        {li.kind === 'previous_balance' && (
                          <span className="ml-2 text-xs text-amber-600">(carry-forward)</span>
                        )}
                      </td>
                      <td className="py-2 text-right text-navy">{formatNaira(li.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-200">
                  <tr>
                    <td className="py-3 font-bold text-navy">Total</td>
                    <td className="py-3 text-right font-bold text-navy">{formatNaira(previewData.total)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="text-xs text-gray-500">
                This is a preview only. {existingInvoice ? 'Click Update invoice to apply.' : 'Click Generate invoice to save.'}
              </p>
            </div>
            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setPreviewData(null)}
                className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
              >
                Close
              </button>
              {!existingInvoice && (
                <button
                  onClick={() => {
                    setPreviewData(null)
                    setGenerateConfirm(true)
                  }}
                  className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
                >
                  Generate this invoice
                </button>
              )}
              {existingInvoice && !isInvoiceUpToDate && (
                <button
                  onClick={() => {
                    setPreviewData(null)
                    setUpdateConfirm(true)
                  }}
                  className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600"
                >
                  Update invoice
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generate confirm */}
      {generateConfirm && (
        <ConfirmDialog
          title={`Generate invoice for ${data.student.firstName} ${data.student.lastName}?`}
          message={`An invoice for ${formatNaira(data.expectedBill)} will be created using current fees, opt-ins, and exemptions.`}
          confirmLabel="Generate"
          onConfirm={handleGenerateInvoice}
          onCancel={() => setGenerateConfirm(false)}
        />
      )}

      {/* Update confirm with diff */}
      {updateConfirm && existingInvoice && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-base font-semibold text-navy mb-2">
                Update invoice for {data.student.firstName} {data.student.lastName}?
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                The invoice will be recalculated using current fees, opt-ins, and exemptions. Payments already made are preserved.
              </p>

              <div className="bg-gray-50 rounded-lg p-4 space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Current total</span>
                  <span className="text-navy">{formatNaira(existingInvoice.totalAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">New total</span>
                  <span className="text-navy font-semibold">{formatNaira(data.expectedBill)}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                  <span className="text-gray-600">Change</span>
                  <span className={diffAmount >= 0 ? 'text-amber-600' : 'text-mint'}>
                    {diffAmount >= 0 ? '+' : ''}{formatNaira(diffAmount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Paid (unchanged)</span>
                  <span className="text-mint">{formatNaira(existingInvoice.paidAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">New outstanding</span>
                  <span className={newOutstanding > 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>
                    {formatNaira(newOutstanding)}
                  </span>
                </div>
              </div>

              {existingInvoice.sentAt && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 mb-4">
                  ⚠️ This invoice was already sent to parents. Updating will flag it for resending.
                </div>
              )}

              {newOutstanding < 0 && (
                <div className="p-3 bg-mint-light border border-mint/30 rounded-lg text-xs text-navy mb-4">
                  Note: The new total is less than already paid. Student will have a credit of {formatNaira(Math.abs(newOutstanding))}.
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setUpdateConfirm(false)}
                disabled={generating}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateInvoice}
                disabled={generating}
                className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50"
              >
                {generating ? 'Updating...' : 'Update invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}