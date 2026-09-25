'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { StudentFeesData, StudentFeeItem } from '@/lib/queries/students'
import {
  toggleStudentOptIn,
  resolveDeferredOptOutOverage,
  resolveUnresolvedCredit,
  setStudentExemption,
  removeStudentExemption,
  regenerateCancelledInvoice
} from '@/app/(app)/students/[id]/actions'
import {
  generateInvoiceForStudent,
  regenerateInvoice
} from '@/app/(app)/fees/cycles/actions'
import { sendInvoiceUpdateNotice } from '@/app/(app)/money/invoices/actions'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import Toast from '@/components/ui/Toast'
import { useCan } from '@/lib/auth/PermissionsProvider'
import { formatDate } from '@/lib/format/date'

interface Props {
  data: StudentFeesData
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
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
  const [removeExemptionError, setRemoveExemptionError] = useState<string | null>(null)
  const [optInConfirm, setOptInConfirm] = useState<StudentFeeItem | null>(null)
  const [overageChoice, setOverageChoice] = useState<{ feeItemId: string; feeItemName: string; overage: number } | null>(null)
  const [resolvingOverage, setResolvingOverage] = useState(false)
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewIframeRef = useRef<HTMLIFrameElement>(null)
  const [generating, setGenerating] = useState(false)
  const [generateConfirm, setGenerateConfirm] = useState(false)
  const [updateConfirm, setUpdateConfirm] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [notified, setNotified] = useState(false)
  const canManageInvoices = useCan('manage-invoices')
  const canManageStudents = useCan('manage-students')

  if (!data.cycle) {
    return (
      <div className="py-16 text-center border-2 border-dashed border-[var(--color-neutral-300)]">
        <p className="text-[var(--color-neutral-700)] mb-2">No active billing cycle.</p>
        <p className="text-sm text-[var(--color-neutral-500)]">Create a term first to manage fees for this student.</p>
      </div>
    )
  }

  if (data.requiredFees.length === 0 && data.optionalFees.length === 0) {
    return (
      <div className="py-16 text-center border-2 border-dashed border-[var(--color-neutral-300)]">
        <p className="text-[var(--color-neutral-700)] mb-2">No fees set up for {data.student.className} yet.</p>
        <Link href="/fees/structure" className="text-sm font-semibold text-[var(--color-signal-text)] hover:underline">
          Go to fee structure &rarr;
        </Link>
      </div>
    )
  }

  // Smart button state
  const existingInvoice = data.existingInvoice
  // A cancelled invoice is a dead record - it still occupies the one row the
  // (student, cycle) unique constraint allows, so it stays the "existing
  // invoice" here, but it must never read as live/current. See the roadmap
  // gap: reissuing a fresh invoice after cancelling isn't supported yet.
  const isCancelled = existingInvoice?.status === 'cancelled'
  // Comparing totalAmount alone misses the case where credit fully covers
  // the bill both before and after a fee change (e.g. a new opt-in) - the
  // total coincidentally stays the same while credit_applied (what's
  // actually owed and drawn from credit) differs.
  const isInvoiceUpToDate = !!existingInvoice
    && !isCancelled
    && existingInvoice.totalAmount === data.expectedBill
    && existingInvoice.creditApplied === data.expectedCreditApplied
  const diffAmount = existingInvoice ? data.expectedBill - existingInvoice.totalAmount : 0
  const newOutstanding = existingInvoice ? data.expectedBill - existingInvoice.paidAmount : 0
  // A full regenerate is only genuinely unsafe when it would claw back money
  // already paid - i.e. the live expected total would drop below what's been
  // paid (a true refund case, deferred to manual reconciliation). A sent-but-
  // unpaid invoice, or a paid invoice where the recompute still covers what's
  // paid (e.g. undoing a mistaken opt-in), can regenerate - it just flags
  // needs_resend so the admin knows to tell the parent. Mirrors the backend
  // guard in regenerateInvoice (fees/cycles/actions.ts).
  const isLocked = !!existingInvoice
    && !isCancelled
    && existingInvoice.paidAmount > 0
    && data.expectedBill < existingInvoice.paidAmount

  function handleToggleClick(fee: StudentFeeItem) {
    if (fee.isOptedIn) {
      handleOptOut(fee)
    } else {
      setOptInConfirm(fee)
    }
  }

  async function handleOptOut(fee: StudentFeeItem) {
    setError(null)
    setPendingId(fee.id)
    const result = await toggleStudentOptIn(data.student.id, fee.id)
    if ('error' in result && result.error) {
      setError(result.error)
    } else if ('deferredToNextTerm' in result && result.deferredToNextTerm) {
      setOverageChoice({ feeItemId: fee.id, feeItemName: result.feeItemName, overage: result.overage })
      router.refresh()
    } else {
      setToast({
        message: `Opted out of ${fee.name} - click "Update invoice" to remove it from this invoice.`,
        ok: true,
      })
      router.refresh()
    }
    setPendingId(null)
  }

  async function handleResolveOverage(decision: 'credit' | 'leave') {
    if (!overageChoice) return
    setResolvingOverage(true)
    const result = await resolveDeferredOptOutOverage(
      data.student.id,
      overageChoice.feeItemId,
      overageChoice.feeItemName,
      decision,
      overageChoice.overage
    )
    if ('error' in result && result.error) {
      setToast({ message: result.error, ok: false })
    } else {
      setToast({
        message: decision === 'credit'
          ? `Credited ${formatNaira(overageChoice.overage)} to ${data.student.firstName}'s balance.`
          : `Left the ${formatNaira(overageChoice.overage)} already paid as-is.`,
        ok: true,
      })
      router.refresh()
    }
    setResolvingOverage(false)
    setOverageChoice(null)
  }

  async function handleResolveUnresolvedCredit(id: string) {
    setPendingId(id)
    const result = await resolveUnresolvedCredit(id)
    if ('error' in result && result.error) {
      setToast({ message: result.error, ok: false })
    } else {
      setToast({ message: 'Marked as resolved.', ok: true })
      router.refresh()
    }
    setPendingId(null)
  }

  async function handleConfirmOptIn() {
    if (!optInConfirm) return
    const fee = optInConfirm
    setError(null)
    setPendingId(fee.id)
    const result = await toggleStudentOptIn(data.student.id, fee.id)
    if ('error' in result && result.error) {
      setError(result.error)
      setToast({ message: result.error, ok: false })
    } else {
      setToast({ message: `Added ${fee.name} (${formatNaira(fee.amount)}) to ${data.student.firstName}'s invoice.`, ok: true })
      router.refresh()
    }
    setOptInConfirm(null)
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
      setToast({ message: result.error, ok: false })
    } else {
      setToast({ message: 'Exemption applied.', ok: true })
      router.refresh()
    }
    setExemptionDialog(null)
    setPendingId(null)
  }

  async function handleRemoveExemption() {
    if (!removeExemptionConfirm) return
    setRemoveExemptionError(null)
    setPendingId(removeExemptionConfirm.id)
    const result = await removeStudentExemption(data.student.id, removeExemptionConfirm.id)
    setPendingId(null)
    if ('error' in result && result.error) {
      setRemoveExemptionError(result.error)
      return
    }
    setToast({ message: 'Exemption removed.', ok: true })
    setRemoveExemptionConfirm(null)
    router.refresh()
  }

  function handlePrintPreview() {
    previewIframeRef.current?.contentWindow?.print()
  }

  async function handleGenerateInvoice() {
    setError(null)
    setGenerating(true)
    const result = await generateInvoiceForStudent(data.student.id, data.cycle!.id)
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
    const result = await regenerateInvoice(existingInvoice.id, true)
    if ('error' in result && result.error) {
      setError(result.error)
      setToast({ message: result.error, ok: false })
    } else {
      setNotified(false)
      setToast({ message: 'Invoice updated.', ok: true })
      router.refresh()
    }
    setGenerating(false)
    setUpdateConfirm(false)
  }

  async function handleRegenerateCancelled() {
    setError(null)
    setGenerating(true)
    const result = await regenerateCancelledInvoice(data.student.id)
    if ('error' in result) {
      setToast({ message: result.error, ok: false })
    } else {
      setToast({ message: 'A fresh invoice has been generated for this term.', ok: true })
      router.refresh()
    }
    setGenerating(false)
  }

  async function handleNotifyUpdate() {
    if (!existingInvoice) return
    setError(null)
    setNotifying(true)
    const result = await sendInvoiceUpdateNotice(existingInvoice.id)
    if ('error' in result) {
      setError(result.error)
    } else {
      setNotified(true)
    }
    setNotifying(false)
  }

  return (
    <>
      <div className="space-y-8">

        {error && (
          <div className="pt-3 border-t-2 border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
            {error}
          </div>
        )}

        {data.student.creditBalance > 0 && (
          <p className="text-xs font-semibold m-num" style={{ color: 'var(--color-ledger)' }}>
            {formatNaira(data.student.creditBalance)} credit on file — applies to their next invoice
          </p>
        )}

        {data.unresolvedCredits.length > 0 && (
          <div className="pt-4 border-t border-[var(--color-neutral-300)]">
            <p className="text-xs font-semibold text-[var(--color-ochre-text)] mb-2 uppercase tracking-[0.06em]">
              Amounts left as-is for a manual refund outside the app
            </p>
            <div className="space-y-1.5">
              {data.unresolvedCredits.map((credit) => (
                <div key={credit.id} className="flex items-center justify-between gap-3 text-xs text-[var(--color-ochre-text)]">
                  <span className="m-num">
                    {formatNaira(credit.amount)} - {credit.feeItemName} ({formatDate(credit.createdAt)})
                  </span>
                  {canManageStudents && (
                    <button
                      onClick={() => handleResolveUnresolvedCredit(credit.id)}
                      disabled={pendingId === credit.id}
                      className="m-btn m-btn-outline m-btn-sm flex-shrink-0"
                    >
                      {pendingId === credit.id ? 'Saving...' : 'Mark as resolved'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">{data.cycle.name}</h2>
            <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">
              Fees that apply to this student for this term
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={!existingInvoice}
              title={!existingInvoice ? 'Generate the invoice first to preview it' : undefined}
              className="m-btn m-btn-outline m-btn-sm"
            >
              Preview invoice
            </button>
            {canManageInvoices && !existingInvoice && (
              <button
                onClick={() => setGenerateConfirm(true)}
                disabled={generating}
                className="m-btn m-btn-primary m-btn-sm"
              >
                Generate invoice
              </button>
            )}
            {canManageInvoices && existingInvoice && !isCancelled && !isInvoiceUpToDate && !isLocked && (
              <button
                onClick={() => setUpdateConfirm(true)}
                disabled={generating}
                className="m-btn m-btn-sm bg-[var(--color-ochre)] text-white hover:bg-[var(--color-ochre-text)]"
              >
                Update invoice
              </button>
            )}
            {existingInvoice && !isCancelled && !isInvoiceUpToDate && isLocked && (
              <span
                className="text-sm text-[var(--color-neutral-700)] italic"
                title="This change would drop the total below what's already been paid - that needs a manual refund/credit reconciliation, not a regenerate."
              >
                Locked - needs refund reconciliation
              </span>
            )}
            {existingInvoice && !isCancelled && isInvoiceUpToDate && (
              <span className="text-sm text-[var(--color-neutral-700)] italic">
                Invoice up to date
              </span>
            )}
            {canManageInvoices && isCancelled && data.student.status === 'active' && (
              <button
                onClick={handleRegenerateCancelled}
                disabled={generating}
                className="m-btn m-btn-primary m-btn-sm"
                title="This invoice was cancelled with no payment or credit against it, so it's safe to regenerate for this same term."
              >
                {generating ? 'Generating...' : 'Generate new invoice'}
              </button>
            )}
          </div>
        </div>

        {/* Existing invoice info */}
        {existingInvoice && isCancelled && (
          <div className="pt-4 border-t border-[var(--color-neutral-300)]">
            <p className="text-xs text-[var(--color-neutral-700)] uppercase tracking-[0.06em] mb-1">Current invoice</p>
            <span className="text-sm font-semibold text-[var(--color-neutral-700)] m-num">
              Cancelled - {formatNaira(existingInvoice.totalAmount)}
            </span>
            <p className="text-xs text-[var(--color-neutral-700)] mt-2">
              {data.student.status === 'active'
                ? 'This invoice was cancelled. Use "Generate new invoice" above to bill this student again for the same term.'
                : 'This invoice was cancelled. Reactivate this student to bill them again for this term.'}
            </p>
          </div>
        )}
        {existingInvoice && !isCancelled && (
          <div className="pt-4 border-t border-[var(--color-neutral-300)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[var(--color-neutral-700)] uppercase tracking-[0.06em] mb-1">Current invoice</p>
                <div className="flex items-center gap-3 flex-wrap">
                  {existingInvoice.creditApplied > 0 ? (
                    <span className="text-sm font-semibold text-[var(--color-ink)] m-num">
                      {formatNaira(existingInvoice.subtotal)} - {formatNaira(existingInvoice.creditApplied)} credit = {formatNaira(existingInvoice.totalAmount)}
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-[var(--color-ink)] m-num">
                      Total: {formatNaira(existingInvoice.totalAmount)}
                    </span>
                  )}
                  <span className="text-[var(--color-neutral-400)]">&middot;</span>
                  <span className="text-sm text-[var(--color-ledger)] m-num">
                    Paid: {formatNaira(existingInvoice.paidAmount)}
                  </span>
                  {existingInvoice.discountAmount > 0 && (
                    <>
                      <span className="text-[var(--color-neutral-400)]">&middot;</span>
                      <span className="text-sm text-[var(--color-neutral-700)] m-num" title={existingInvoice.discountReason || undefined}>
                        Discount: -{formatNaira(existingInvoice.discountAmount)}
                      </span>
                    </>
                  )}
                  <span className="text-[var(--color-neutral-400)]">&middot;</span>
                  <span className={`text-sm font-medium m-num ${existingInvoice.outstandingAmount > 0 ? 'text-[var(--color-ochre-text)]' : 'text-[var(--color-neutral-500)]'}`}>
                    Outstanding: {formatNaira(existingInvoice.outstandingAmount)}
                  </span>
                  {existingInvoice.needsResend && (
                    <>
                      <span className="text-[var(--color-neutral-400)]">&middot;</span>
                      <span className="text-xs font-semibold uppercase" style={{ color: 'var(--color-ochre-text)', letterSpacing: '0.08em' }}>
                        Needs resend
                      </span>
                      {canManageInvoices && (
                        notified ? (
                          <span className="text-xs text-[var(--color-ink)] font-medium">Notified</span>
                        ) : (
                          <button
                            onClick={handleNotifyUpdate}
                            disabled={notifying}
                            className="text-xs font-semibold text-[var(--color-signal-text)] hover:underline disabled:opacity-50"
                          >
                            {notifying ? 'Sending...' : 'Notify parent of update'}
                          </button>
                        )
                      )}
                    </>
                  )}
                </div>
                {!isInvoiceUpToDate && (
                  <p className={`text-xs mt-2 ${isLocked ? 'text-[var(--color-neutral-700)]' : 'text-[var(--color-ochre-text)]'}`}>
                    Adjustments have been made. Current invoice ({formatNaira(existingInvoice.totalAmount)})
                    differs from expected ({formatNaira(data.expectedBill)}).
                    {isLocked
                      ? ' Applying this would drop the invoice below what’s already been paid, which needs a manual refund/credit reconciliation. (A new fee opt-in still applies to this invoice instantly.)'
                      : ' Click "Update invoice" to apply.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Fees ledger - required, opt-in, and adjustments as one continuous table */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)]">Fees ledger</h3>
            <p className="text-xs text-[var(--color-neutral-700)]">{data.cycle.name}</p>
          </div>

          {data.requiredFees.length === 0 && data.optionalFees.length === 0 ? (
            <p className="text-[var(--color-neutral-700)] text-sm py-6 text-center">No fees for this class.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="m-table">
                <thead>
                  <tr>
                    <th className="w-12"></th>
                    <th>Item</th>
                    <th className="text-right">Kind</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requiredFees.length > 0 && (
                    <tr>
                      <td colSpan={5} className="pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)]">
                        Required &middot; auto-applied to all students in {data.student.className}
                      </td>
                    </tr>
                  )}
                  {data.requiredFees.map(fee => (
                    <tr key={fee.id} className={fee.isExempted ? 'opacity-60' : ''}>
                      <td></td>
                      <td>
                        <span className={fee.isExempted ? 'line-through' : ''}>
                          {fee.name}
                        </span>
                        {fee.isSchoolWide && (
                          <span className="ml-2 text-xs text-[var(--color-neutral-700)]">(school-wide)</span>
                        )}
                        {fee.isExempted && fee.exemptionNotes && (
                          <p className="text-xs text-[var(--color-ochre-text)] mt-0.5">Note: {fee.exemptionNotes}</p>
                        )}
                      </td>
                      <td className="text-right text-xs text-[var(--color-neutral-500)]"></td>
                      <td className={`text-right m-num ${fee.isExempted ? 'line-through text-[var(--color-neutral-500)]' : 'font-medium'}`}>
                        {formatNaira(fee.amount)}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {fee.isExempted ? (
                            <span className="text-xs font-semibold uppercase" style={{ color: 'var(--color-ochre-text)', letterSpacing: '0.08em' }}>Exempted</span>
                          ) : (
                            <span className="text-xs text-[var(--color-neutral-700)]">Applied</span>
                          )}
                          {canManageStudents && (fee.isExempted ? (
                            <button
                              onClick={() => { setRemoveExemptionError(null); setRemoveExemptionConfirm(fee) }}
                              disabled={pendingId === fee.id}
                              className="text-xs font-semibold text-[var(--color-signal-text)] hover:underline disabled:opacity-50"
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              onClick={() => setExemptionDialog({ fee, notes: '' })}
                              disabled={pendingId === fee.id}
                              className="text-xs font-medium text-[var(--color-neutral-700)] hover:underline disabled:opacity-50"
                            >
                              Mark exempt
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.exemptionTotal > 0 && (
                    <tr>
                      <td colSpan={3}></td>
                      <td className="text-right text-xs text-[var(--color-ochre-text)] m-num">-{formatNaira(data.exemptionTotal)}</td>
                      <td className="text-right text-xs text-[var(--color-ochre-text)]">Less exemptions</td>
                    </tr>
                  )}

                  {data.optionalFees.length > 0 && (
                    <tr>
                      <td colSpan={5} className="pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)]">
                        Opt-in &middot; tick to opt this student in
                      </td>
                    </tr>
                  )}
                  {data.optionalFees.map(fee => (
                    <tr key={fee.id}>
                      <td>
                        {canManageStudents && (
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={fee.isOptedIn}
                            aria-label={fee.isOptedIn ? `Opt out of ${fee.name}` : `Opt in to ${fee.name}`}
                            onClick={() => handleToggleClick(fee)}
                            disabled={pendingId === fee.id}
                            className="inline-block flex-shrink-0 border-2 border-[var(--color-ink)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              width: 20,
                              height: 20,
                              background: fee.isOptedIn ? 'var(--color-ink)' : 'transparent',
                              boxShadow: fee.isOptedIn ? 'inset 0 0 0 2px var(--color-paper)' : 'none',
                            }}
                          />
                        )}
                      </td>
                      <td>
                        <span>{fee.name}</span>
                        {fee.isSchoolWide && (
                          <span className="ml-2 text-xs text-[var(--color-neutral-700)]">(school-wide)</span>
                        )}
                      </td>
                      <td className="text-right text-xs" style={{ color: fee.isOptedIn ? 'var(--color-ochre-text)' : 'var(--color-neutral-500)' }}>
                        OPT-IN
                      </td>
                      <td className={`text-right m-num ${fee.isOptedIn ? 'font-medium' : 'text-[var(--color-neutral-500)]'}`}>
                        {formatNaira(fee.amount)}
                      </td>
                      <td className="text-right">
                        {fee.isOptedIn ? (
                          <span className="text-xs font-semibold uppercase" style={{ color: 'var(--color-ink)', letterSpacing: '0.08em' }}>Opted in</span>
                        ) : (
                          <span className="text-xs text-[var(--color-neutral-500)]">Not opted in</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {(data.expectedDiscountAmount > 0 || data.expectedCreditApplied > 0) && (
                    <tr>
                      <td colSpan={5} className="pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)]">
                        Adjustments
                      </td>
                    </tr>
                  )}
                  {data.expectedDiscountAmount > 0 && (
                    <tr>
                      <td></td>
                      <td>
                        <span>Discount</span>
                        {data.expectedDiscountReason && (
                          <p className="text-xs text-[var(--color-neutral-500)] mt-0.5">{data.expectedDiscountReason}</p>
                        )}
                      </td>
                      <td></td>
                      <td className="text-right m-num font-medium" style={{ color: 'var(--color-ledger)' }}>
                        -{formatNaira(data.expectedDiscountAmount)}
                      </td>
                      <td></td>
                    </tr>
                  )}
                  {data.expectedCreditApplied > 0 && (
                    <tr>
                      <td></td>
                      <td>Credit applied</td>
                      <td></td>
                      <td className="text-right m-num font-medium whitespace-nowrap" style={{ color: 'var(--color-ledger)' }}>
                        {'-' + formatNaira(data.expectedCreditApplied)}
                      </td>
                      <td className="text-right text-xs text-[var(--color-neutral-500)]">From balance on file</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="border-t-2 border-[var(--color-ink)]"></td>
                    <td className="text-lg font-extrabold text-right m-num border-t-2 border-[var(--color-ink)]">
                      {formatNaira(data.expectedBill)}
                    </td>
                    <td className="text-xs font-bold uppercase tracking-[0.08em] text-right border-t-2 border-[var(--color-ink)]">
                      Expected bill this term
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} ok={toast.ok} onDismiss={() => setToast(null)} />
      )}

      {/* Opt-in confirm dialog */}
      {optInConfirm && (
        <ConfirmDialog
          title={`Add ${optInConfirm.name} to ${data.student.firstName}'s invoice?`}
          message={`Increases what ${data.student.firstName} owes by ${formatNaira(optInConfirm.amount)}.`}
          confirmLabel="Add fee"
          onConfirm={handleConfirmOptIn}
          onCancel={() => setOptInConfirm(null)}
        />
      )}

      {/* Opt-out on a paid invoice: the invoice itself isn't touched, this
          only decides what happens to the amount already paid for the fee */}
      {overageChoice && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
          <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
            <div className="p-6">
              <h3 className="text-lg font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-2">
                {overageChoice.feeItemName} was already paid for this term
              </h3>
              <p className="text-sm text-[var(--color-neutral-700)] m-num">
                {data.student.firstName} won&apos;t be charged {overageChoice.feeItemName} from next term -
                this term&apos;s invoice stays exactly as it was paid. What should happen to the{' '}
                {formatNaira(overageChoice.overage)} already paid for it?
              </p>
              <p className="text-xs text-[var(--color-neutral-500)] mt-2">
                Cash refunds aren&apos;t handled here - contact support to reconcile those.
              </p>
            </div>
            <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
              <button
                onClick={() => handleResolveOverage('leave')}
                disabled={resolvingOverage}
                className="m-btn m-btn-outline m-btn-sm"
              >
                Leave as-is
              </button>
              <button
                onClick={() => handleResolveOverage('credit')}
                disabled={resolvingOverage}
                className="m-btn m-btn-primary m-btn-sm"
              >
                {resolvingOverage ? 'Saving...' : `Credit ${formatNaira(overageChoice.overage)} to balance`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exemption dialog */}
      {exemptionDialog && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
          <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
            <div className="p-6">
              <h3 className="text-lg font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-2">
                Exempt from &quot;{exemptionDialog.fee.name}&quot;?
              </h3>
              <p className="text-sm text-[var(--color-neutral-700)] mb-4 m-num">
                {data.student.firstName} {data.student.lastName} won&apos;t be charged {formatNaira(exemptionDialog.fee.amount)} for this fee.
              </p>

              {existingInvoice && !isCancelled && existingInvoice.paidAmount > 0
                && (data.expectedBill - exemptionDialog.fee.amount) < existingInvoice.paidAmount && (
                <div className="mb-4 pt-3 border-t border-[var(--color-neutral-300)]">
                  <p className="text-xs text-[var(--color-ochre-text)]">
                    <span className="font-semibold">Heads up:</span> {data.student.firstName} has already paid {formatNaira(existingInvoice.paidAmount)}
                    {' '}on this term&apos;s invoice - more than this exemption would leave owed. The invoice can&apos;t be regenerated
                    afterward (that would need a manual refund/credit reconciliation), so it will stay locked at its current amount
                    until that&apos;s resolved.
                  </p>
                </div>
              )}
              {existingInvoice && !isCancelled && existingInvoice.paidAmount === 0 && existingInvoice.sentAt && (
                <div className="mb-4 pt-3 border-t border-[var(--color-neutral-300)]">
                  <p className="text-xs text-[var(--color-ochre-text)]">
                    <span className="font-semibold">Heads up:</span> this term&apos;s invoice has already been sent to the parent
                    including this fee. Consider notifying them after regenerating so the new total doesn&apos;t come as a surprise.
                  </p>
                </div>
              )}

              <label className="m-label">Reason (optional)</label>
              <textarea
                value={exemptionDialog.notes}
                onChange={(e) => setExemptionDialog({ ...exemptionDialog, notes: e.target.value })}
                placeholder="e.g. Scholarship, staff child, sibling discount..."
                rows={3}
                className="m-textarea"
                autoFocus
              />
              <p className="text-xs text-[var(--color-neutral-500)] mt-1">Helpful for record-keeping later</p>
            </div>

            <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
              <button
                onClick={() => setExemptionDialog(null)}
                disabled={pendingId === exemptionDialog.fee.id}
                className="m-btn m-btn-outline m-btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmExemption}
                disabled={pendingId === exemptionDialog.fee.id}
                className="m-btn m-btn-primary m-btn-sm"
              >
                {pendingId === exemptionDialog.fee.id ? 'Saving...' : 'Confirm exemption'}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeExemptionConfirm && (
        <DestructiveConfirmModal
          title={`Remove exemption for "${removeExemptionConfirm.name}"?`}
          description={`${data.student.firstName} ${data.student.lastName} is charged this fee again from now on.`}
          rows={[
            { label: 'Added back to what they owe', value: formatNaira(removeExemptionConfirm.amount), emphasize: true },
          ]}
          note={existingInvoice && !isCancelled
            ? "This term's invoice already exists and won't change until you update or regenerate it."
            : undefined}
          error={removeExemptionError}
          actions={[
            { label: 'Cancel', onClick: () => setRemoveExemptionConfirm(null), variant: 'outline', disabled: pendingId === removeExemptionConfirm.id },
            { label: pendingId === removeExemptionConfirm.id ? 'Removing...' : 'Remove exemption', onClick: handleRemoveExemption, variant: 'danger', disabled: pendingId === removeExemptionConfirm.id },
          ]}
        />
      )}

      {/* Preview modal - renders the actual invoice PDF */}
      {previewOpen && existingInvoice && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
          <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-3xl w-full h-[85vh] flex flex-col m-anim-scale">
            <div className="p-5 border-b-2 border-[var(--color-ink)] flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-extrabold tracking-[-0.015em] text-[var(--color-ink)]">Invoice preview</h3>
                <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">
                  {data.student.firstName} {data.student.lastName} &middot; {data.cycle?.name}
                </p>
              </div>
              <button onClick={() => setPreviewOpen(false)} aria-label="Close" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
                Close
              </button>
            </div>
            <div className="flex-1 bg-[var(--color-surface)] min-h-0">
              <iframe
                ref={previewIframeRef}
                src={`/api/invoices/${existingInvoice.id}/pdf`}
                title="Invoice preview"
                className="w-full h-full border-0"
              />
            </div>
            <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-between flex-shrink-0">
              {!isInvoiceUpToDate && (
                <p className="text-xs text-[var(--color-ochre-text)]">
                  This invoice is out of date - update it to print the latest version.
                </p>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setPreviewOpen(false)}
                  className="m-btn m-btn-outline m-btn-sm"
                >
                  Close
                </button>
                <button
                  onClick={handlePrintPreview}
                  disabled={!isInvoiceUpToDate}
                  title={!isInvoiceUpToDate ? 'Update the invoice before printing' : undefined}
                  className="m-btn m-btn-primary m-btn-sm"
                >
                  Print
                </button>
              </div>
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
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
          <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
            <div className="p-6">
              <h3 className="text-lg font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-2">
                Update invoice for {data.student.firstName} {data.student.lastName}?
              </h3>
              <p className="text-sm text-[var(--color-neutral-700)] mb-4">
                The invoice will be recalculated using current fees, opt-ins, and exemptions. Payments already made are preserved.
              </p>

              <div className="bg-[var(--color-surface)] p-4 space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-neutral-700)]">Current total</span>
                  <span className="text-[var(--color-ink)] m-num">{formatNaira(existingInvoice.totalAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-neutral-700)]">New total</span>
                  <span className="text-[var(--color-ink)] font-semibold m-num">{formatNaira(data.expectedBill)}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-[var(--color-neutral-300)]">
                  <span className="text-[var(--color-neutral-700)]">Change</span>
                  <span className={`m-num ${diffAmount >= 0 ? 'text-[var(--color-ochre-text)]' : 'text-[var(--color-ledger)]'}`}>
                    {diffAmount >= 0 ? '+' : ''}{formatNaira(diffAmount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-neutral-700)]">Paid (unchanged)</span>
                  <span className="text-[var(--color-ledger)] m-num">{formatNaira(existingInvoice.paidAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-neutral-700)]">New outstanding</span>
                  <span className={`m-num ${newOutstanding > 0 ? 'text-[var(--color-ochre-text)] font-semibold' : 'text-[var(--color-neutral-500)]'}`}>
                    {formatNaira(newOutstanding)}
                  </span>
                </div>
              </div>

              {newOutstanding < 0 && (
                <div className="pt-3 border-t border-[var(--color-neutral-300)] text-xs text-[var(--color-ledger)] mb-4 m-num">
                  Note: The new total is less than already paid. Student will have a credit of {formatNaira(Math.abs(newOutstanding))}.
                </div>
              )}
            </div>

            <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
              <button
                onClick={() => setUpdateConfirm(false)}
                disabled={generating}
                className="m-btn m-btn-outline m-btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateInvoice}
                disabled={generating}
                className="m-btn m-btn-sm bg-[var(--color-ochre)] text-white hover:bg-[var(--color-ochre-text)]"
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