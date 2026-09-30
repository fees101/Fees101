'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateStudentDetails,
  updateFamilyInfo,
  updateFamilyNotes,
  updateStudentStatus,
  getWithdrawalPreview,
  getClassesList
} from '@/app/(app)/students/[id]/actions'
import { cancelInvoice } from '@/app/(app)/money/invoices/[id]/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'
import Toast from '@/components/ui/Toast'

interface Student {
  id: string
  firstName: string
  lastName: string
  admissionNumber: string
  classId: string
  className: string
  admissionDate: string
  status: string
  family: {
    id: string
    primaryParentName: string
    primaryParentPhone: string
    primaryParentEmail: string | null
    secondaryParentName: string | null
    secondaryParentPhone: string | null
    secondaryParentEmail: string | null
    notes: string | null
  }
}

interface Props {
  student: Student
  onClose?: () => void
}

interface StudentForm {
  firstName: string
  lastName: string
  admissionNumber: string
  classId: string
  admissionDate: string
}

interface FamilyForm {
  primaryParentName: string
  primaryParentPhone: string
  primaryParentEmail: string
  secondaryParentName: string
  secondaryParentPhone: string
  secondaryParentEmail: string
}

interface ClassMoveConfirm {
  oldClassName: string | null
  newClassName: string | null
  invoice: {
    id: string
    invoiceNumber: string | null
    state: 'clean' | 'has_payment'
    currentTotal: number
    newTotal: number | null
    paidAmount: number
    creditApplied: number
  }
}

function studentFormFrom(student: Student): StudentForm {
  return {
    firstName: student.firstName,
    lastName: student.lastName,
    admissionNumber: student.admissionNumber,
    classId: student.classId,
    admissionDate: student.admissionDate,
  }
}

function familyFormFrom(family: Student['family']): FamilyForm {
  return {
    primaryParentName: family.primaryParentName,
    primaryParentPhone: family.primaryParentPhone,
    primaryParentEmail: family.primaryParentEmail || '',
    secondaryParentName: family.secondaryParentName || '',
    secondaryParentPhone: family.secondaryParentPhone || '',
    secondaryParentEmail: family.secondaryParentEmail || '',
  }
}

// The drawer opens straight into edit mode: every field below is a live
// input from the start, no separate "Edit" link and no second modal. All
// three sections (student details, family info, notes) share one Save/
// Cancel pair at the bottom, even though they hit three separate server
// actions underneath — Cancel resets every field back to the student prop
// in one go. Status is a dropdown, kept out of that shared save since
// picking withdrawn/graduated needs its own confirmation (it can affect an
// open invoice) and reactivating is applied immediately, not staged.
export default function StudentSettingsTab({ student, onClose }: Props) {
  const router = useRouter()
  const canManage = useCan('manage-students')

  const [studentForm, setStudentForm] = useState<StudentForm>(() => studentFormFrom(student))
  const [familyForm, setFamilyForm] = useState<FamilyForm>(() => familyFormFrom(student.family))
  const [showSecondary, setShowSecondary] = useState(!!student.family.secondaryParentName)
  const [notes, setNotes] = useState(student.family.notes || '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [classMoveConfirm, setClassMoveConfirm] = useState<ClassMoveConfirm | null>(null)

  const [confirmAction, setConfirmAction] = useState<'withdrawn' | 'graduated' | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [classes, setClasses] = useState<{ id: string, name: string }[]>([])
  const [reactivating, setReactivating] = useState(false)
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    getClassesList().then(setClasses)
  }, [])

  function handleCancel() {
    setStudentForm(studentFormFrom(student))
    setFamilyForm(familyFormFrom(student.family))
    setShowSecondary(!!student.family.secondaryParentName)
    setNotes(student.family.notes || '')
    setSaveError(null)
    onClose?.()
  }

  async function saveFamilyAndNotes(): Promise<string | null> {
    const familyResult = await updateFamilyInfo(student.family.id, student.id, {
      ...familyForm,
      secondaryParentName: showSecondary ? familyForm.secondaryParentName : '',
      secondaryParentPhone: showSecondary ? familyForm.secondaryParentPhone : '',
      secondaryParentEmail: showSecondary ? familyForm.secondaryParentEmail : '',
    })
    if (familyResult.error) return familyResult.error
    const notesResult = await updateFamilyNotes(student.family.id, student.id, notes)
    if (notesResult.error) return notesResult.error
    return null
  }

  async function handleSave() {
    setSaveError(null)
    setSaving(true)
    const result = await updateStudentDetails(student.id, studentForm)
    if ('error' in result) {
      setSaving(false)
      setSaveError(result.error)
      return
    }
    if ('needsConfirm' in result) {
      setSaving(false)
      setClassMoveConfirm({ oldClassName: result.oldClassName, newClassName: result.newClassName, invoice: result.invoice })
      return
    }
    const err = await saveFamilyAndNotes()
    setSaving(false)
    if (err) {
      setSaveError(err)
      return
    }
    router.refresh()
  }

  async function handleClassMoveContinue() {
    setSaveError(null)
    setSaving(true)
    const result = await updateStudentDetails(student.id, studentForm, true)
    if ('error' in result) {
      setSaving(false)
      setSaveError(result.error)
      return
    }
    const err = await saveFamilyAndNotes()
    setSaving(false)
    if (err) {
      setSaveError(err)
      return
    }
    setClassMoveConfirm(null)
    router.refresh()
  }

  async function handleStatusChange(next: string) {
    if (next === student.status) return
    setStatusError(null)
    if (next === 'active') {
      setReactivating(true)
      const result = await updateStudentStatus(student.id, 'active')
      setReactivating(false)
      if ('error' in result) {
        setStatusError(result.error)
        return
      }
      router.refresh()
      return
    }
    setConfirmAction(next as 'withdrawn' | 'graduated')
  }

  return (
    <div className="space-y-8">
      {canManage && (
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)] mb-4">Status</h2>
          <div className="border-t-2 border-[var(--color-ink)] pt-4">
            <label className="block">
              <span className="m-label">Enrolment status</span>
              <select
                value={student.status}
                disabled={reactivating}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="m-select w-full box-border"
              >
                <option value="active">Enrolled</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="graduated">Graduated</option>
              </select>
            </label>
            <p className="text-xs text-[var(--color-neutral-700)] mt-2">
              {student.status === 'active'
                ? 'Marking as withdrawn or graduated will ask what to do with any open invoice for this term.'
                : 'Switching back to Enrolled restores active status and, if a term invoice was cancelled at withdrawal, brings it back so the student can be billed and collected from again.'}
            </p>
            {statusError && <div className="mt-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">{statusError}</div>}
          </div>
        </div>
      )}

      <StudentDetailsSection form={studentForm} setForm={setStudentForm} classes={classes} canManage={canManage} />
      <FamilyInfoSection form={familyForm} setForm={setFamilyForm} showSecondary={showSecondary} setShowSecondary={setShowSecondary} canManage={canManage} />
      <NotesSection notes={notes} setNotes={setNotes} canManage={canManage} />

      {canManage && (
        <div>
          {saveError && <div className="mb-4 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">{saveError}</div>}
          <div className="flex items-center gap-2 pt-4 border-t-2 border-[var(--color-ink)]">
            <button onClick={handleSave} disabled={saving} className="m-btn m-btn-primary m-btn-sm">
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button onClick={handleCancel} disabled={saving} className="m-btn m-btn-outline m-btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {classMoveConfirm && (
        <ClassMoveConfirmModal
          name={`${studentForm.firstName} ${studentForm.lastName}`.trim()}
          confirm={classMoveConfirm}
          loading={saving}
          error={saveError}
          onClose={() => { setClassMoveConfirm(null); setSaveError(null) }}
          onContinue={handleClassMoveContinue}
        />
      )}

      {/* Confirm danger action modal. Withdrawal gets the money-aware,
          single-dialog flow (WithdrawConfirmModal) — graduation keeps the
          simpler generic confirm since it carries no "this moves money"
          framing in the redesign. */}
      {confirmAction === 'withdrawn' && (
        <WithdrawConfirmModal
          studentId={student.id}
          studentName={`${student.firstName} ${student.lastName}`}
          onClose={() => setConfirmAction(null)}
          onConfirmed={() => { setConfirmAction(null); router.refresh() }}
          onResult={setActionResult}
        />
      )}
      {confirmAction === 'graduated' && (
        <ConfirmStatusModal
          studentId={student.id}
          studentName={`${student.firstName} ${student.lastName}`}
          action={confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirmed={() => { setConfirmAction(null); router.refresh() }}
          onResult={setActionResult}
        />
      )}

      {actionResult && (
        <Toast message={actionResult.message} ok={actionResult.ok} onDismiss={() => setActionResult(null)} />
      )}
    </div>
  )
}

function StudentDetailsSection({ form, setForm, classes, canManage }: {
  form: StudentForm
  setForm: (form: StudentForm) => void
  classes: { id: string, name: string }[]
  canManage: boolean
}) {
  return (
    <div>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)] mb-4">Student details</h2>

      <div className="border-t-2 border-[var(--color-ink)] pt-4">
        <label className="block mb-3.5">
          <span className="m-label">First name</span>
          <input type="text" value={form.firstName} disabled={!canManage}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="m-input w-full box-border" />
        </label>
        <label className="block mb-3.5">
          <span className="m-label">Last name</span>
          <input type="text" value={form.lastName} disabled={!canManage}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="m-input w-full box-border" />
        </label>
        <label className="block mb-3.5">
          <span className="m-label">Admission number</span>
          <input type="text" value={form.admissionNumber} disabled={!canManage}
            onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })} className="m-input w-full box-border" />
        </label>
        <label className="block mb-3.5">
          <span className="m-label">Class</span>
          <select value={form.classId} disabled={!canManage}
            onChange={(e) => setForm({ ...form, classId: e.target.value })} className="m-select w-full box-border">
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="m-label">Admission date</span>
          <input type="date" value={form.admissionDate} disabled={!canManage}
            onChange={(e) => setForm({ ...form, admissionDate: e.target.value })} className="m-input w-full box-border" />
        </label>
      </div>
    </div>
  )
}

function ClassMoveConfirmModal({ name, confirm, loading, error, onClose, onContinue }: {
  name: string
  confirm: ClassMoveConfirm
  loading: boolean
  error: string | null
  onClose: () => void
  onContinue: () => void
}) {
  const to = confirm.newClassName || 'the new class'
  const invLabel = confirm.invoice.invoiceNumber || 'their invoice for this term'
  const clean = confirm.invoice.state === 'clean'
  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[var(--color-ink)] mb-2">Move {name} to {to}?</h3>
          {clean ? (
            <p className="text-sm text-[var(--color-neutral-700)] mb-4">
              {invLabel} will be recalculated onto {to}&apos;s fees.
              {confirm.invoice.newTotal !== null ? (
                <>
                  {' '}The total changes from{' '}
                  <span className="font-medium text-[var(--color-ink)] m-num">₦{confirm.invoice.currentTotal.toLocaleString()}</span>
                  {' '}to{' '}
                  <span className="font-medium text-[var(--color-ink)] m-num">₦{confirm.invoice.newTotal.toLocaleString()}</span>.
                </>
              ) : (
                <> Its total (currently ₦{confirm.invoice.currentTotal.toLocaleString()}) will be updated to match.</>
              )}
            </p>
          ) : (
            <p className="text-sm text-[var(--color-neutral-700)] mb-4">
              {invLabel} already has {[
                confirm.invoice.paidAmount > 0 ? `₦${confirm.invoice.paidAmount.toLocaleString()} paid` : null,
                confirm.invoice.creditApplied > 0 ? `₦${confirm.invoice.creditApplied.toLocaleString()} credit` : null,
              ].filter(Boolean).join(' and ')} applied, so it will not be recalculated automatically.
              The class will change, but you&apos;ll need to review that invoice and issue a refund or
              extra charge if {to}&apos;s fees differ.
            </p>
          )}
          {error && <div className="mb-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">{error}</div>}
        </div>
        <div className="p-6 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="m-btn m-btn-outline m-btn-sm"
          >
            Cancel
          </button>
          <button
            onClick={onContinue}
            disabled={loading}
            className={`m-btn m-btn-sm ${clean ? 'm-btn-primary' : ''}`}
          >
            {loading ? 'Working...' : clean ? 'Continue' : 'Continue anyway'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FamilyInfoSection({ form, setForm, showSecondary, setShowSecondary, canManage }: {
  form: FamilyForm
  setForm: (form: FamilyForm) => void
  showSecondary: boolean
  setShowSecondary: (show: boolean) => void
  canManage: boolean
}) {
  return (
    <div>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)] mb-4">Family information</h2>

      <div className="border-t-2 border-[var(--color-ink)] pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)] mb-3">Primary parent</p>
        <label className="block mb-3.5">
          <span className="m-label">Name</span>
          <input type="text" value={form.primaryParentName} disabled={!canManage}
            onChange={(e) => setForm({ ...form, primaryParentName: e.target.value })} className="m-input w-full box-border" />
        </label>
        <label className="block mb-3.5">
          <span className="m-label">Phone</span>
          <input type="text" value={form.primaryParentPhone} disabled={!canManage}
            onChange={(e) => setForm({ ...form, primaryParentPhone: e.target.value })} className="m-input w-full box-border" />
        </label>
        <label className="block">
          <span className="m-label">Email (optional)</span>
          <input type="email" value={form.primaryParentEmail} disabled={!canManage}
            onChange={(e) => setForm({ ...form, primaryParentEmail: e.target.value })} className="m-input w-full box-border" />
        </label>
      </div>

      <div className="mt-4 pt-4 border-t border-[var(--color-neutral-300)]">
        {showSecondary ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)]">Secondary parent</p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setShowSecondary(false)}
                  className="text-xs font-semibold text-[var(--color-signal-text)] hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <label className="block mb-3.5">
              <span className="m-label">Name</span>
              <input type="text" value={form.secondaryParentName} disabled={!canManage}
                onChange={(e) => setForm({ ...form, secondaryParentName: e.target.value })} className="m-input w-full box-border" />
            </label>
            <label className="block mb-3.5">
              <span className="m-label">Phone</span>
              <input type="text" value={form.secondaryParentPhone} disabled={!canManage}
                onChange={(e) => setForm({ ...form, secondaryParentPhone: e.target.value })} className="m-input w-full box-border" />
            </label>
            <label className="block">
              <span className="m-label">Email (optional)</span>
              <input type="email" value={form.secondaryParentEmail} disabled={!canManage}
                onChange={(e) => setForm({ ...form, secondaryParentEmail: e.target.value })} className="m-input w-full box-border" />
            </label>
          </>
        ) : (
          canManage ? (
            <button type="button" onClick={() => setShowSecondary(true)} className="text-sm font-semibold text-[var(--color-signal-text)] hover:underline">
              + Add secondary parent
            </button>
          ) : (
            <p className="text-sm text-[var(--color-neutral-500)] italic">No secondary parent added</p>
          )
        )}
      </div>
    </div>
  )
}

function NotesSection({ notes, setNotes, canManage }: {
  notes: string
  setNotes: (notes: string) => void
  canManage: boolean
}) {
  return (
    <div>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)] mb-3">Notes</h2>
      <div className="border-t-2 border-[var(--color-ink)] pt-4">
        <p className="text-xs text-[var(--color-neutral-700)] mb-2">Notes are visible to all staff with access to this student.</p>
        <textarea
          value={notes}
          disabled={!canManage}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          placeholder="Add notes about this family..."
          className="m-textarea"
        />
      </div>
    </div>
  )
}

type WithdrawalPreview =
  | { success: true; activeCycleName: string | null; openInvoice: { id: string; invoiceNumber: string | null; outstandingAmount: number; cancellable: boolean } | null; totalPaid: number; siblingCount: number }
  | { error: string }

// Withdrawal is money-moving (it can leave an open invoice needing a
// decision and recalculates sibling discounts), so it gets ONE dialog that
// states the impact up front and asks for the invoice decision before
// anything is written — replacing the old flow of a generic confirm
// followed by a second dialog that appeared only after the status change had
// already been saved. The status write and any invoice cancellation still go
// through the exact same server actions (updateStudentStatus, cancelInvoice)
// with the exact same guards; this only changes when the admin is asked.
function WithdrawConfirmModal({ studentId, studentName, onClose, onConfirmed, onResult }: {
  studentId: string
  studentName: string
  onClose: () => void
  onConfirmed: () => void
  onResult: (result: { ok: boolean; message: string }) => void
}) {
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canManageInvoices = useCan('manage-invoices')

  useEffect(() => {
    let cancelled = false
    getWithdrawalPreview(studentId).then((result) => { if (!cancelled) setPreview(result) })
    return () => { cancelled = true }
  }, [studentId])

  // `preview &&` (not `!!preview &&`) so TS narrows the reference itself —
  // needed before the 'in' check below, since 'in' on a possibly-null value
  // is a type error, not just a runtime one.
  const successPreview = preview && 'success' in preview ? preview : null
  const previewError = preview && 'error' in preview ? preview.error : null
  const openInvoice = successPreview?.openInvoice ?? null
  const showInvoiceDecision = !!openInvoice && openInvoice.cancellable && canManageInvoices

  async function handleConfirm(cancelOpenInvoice: boolean) {
    setError(null)
    setLoading(true)
    const result = await updateStudentStatus(studentId, 'withdrawn')
    if ('error' in result) {
      setLoading(false)
      setError(result.error)
      onResult({ ok: false, message: result.error })
      return
    }
    if (cancelOpenInvoice) {
      for (const inv of result.openInvoices) {
        const cancelResult = await cancelInvoice(inv.id)
        if ('error' in cancelResult) {
          setLoading(false)
          onResult({ ok: false, message: `${studentName} marked as withdrawn, but the open invoice could not be cancelled: ${cancelResult.error}` })
          onConfirmed()
          return
        }
      }
      onResult({ ok: true, message: `${studentName} marked as withdrawn and their open invoice cancelled.` })
    } else {
      onResult({ ok: true, message: `${studentName} marked as withdrawn.` })
    }
    setLoading(false)
    onConfirmed()
  }

  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
        <div className="p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-signal-text)] mb-2">
            This moves money
          </p>
          <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-2">
            Withdraw {studentName}
          </h3>
          <p className="text-sm text-[var(--color-neutral-700)] mb-3">
            {successPreview?.activeCycleName
              ? `They leave the active roster and stop being billed from ${successPreview.activeCycleName}. Their record and payment history stay.`
              : 'They leave the active roster and stop being billed going forward. Their record and payment history stay.'}
          </p>

          {!preview && (
            <p className="text-sm text-[var(--color-neutral-500)] mb-2">Checking their invoices...</p>
          )}

          {previewError && (
            <p className="text-sm text-[var(--color-neutral-500)] mb-2">
              Couldn&apos;t load their invoice details ({previewError}) — you can still withdraw and handle any open invoice separately.
            </p>
          )}

          {successPreview && (
            <div className="mb-1">
              {successPreview.openInvoice && (
                <div className="border-t border-[var(--color-neutral-300)] py-2.5 flex items-center justify-between gap-3">
                  <span className="text-[13px] text-[var(--color-neutral-800)]">
                    Open invoice{successPreview.openInvoice.invoiceNumber ? ` ${successPreview.openInvoice.invoiceNumber}` : ''}
                  </span>
                  <span className="text-sm font-semibold m-num text-[var(--color-ochre-text)]">
                    ₦{successPreview.openInvoice.outstandingAmount.toLocaleString()} unpaid
                  </span>
                </div>
              )}
              <div className="border-t border-[var(--color-neutral-300)] py-2.5 flex items-center justify-between gap-3">
                <span className="text-[13px] text-[var(--color-neutral-800)]">Paid so far, kept on record</span>
                <span className="text-sm font-semibold m-num text-[var(--color-ledger)]">₦{successPreview.totalPaid.toLocaleString()}</span>
              </div>
              {successPreview.siblingCount > 0 && (
                <div className="border-t border-[var(--color-neutral-300)] border-b-2 border-b-[var(--color-ink)] py-2.5 flex items-center justify-between gap-3">
                  <span className="text-[13px] text-[var(--color-neutral-800)]">Siblings still enrolled</span>
                  <span className="text-sm font-semibold text-[var(--color-ink)]">{successPreview.siblingCount} · discount recalculates</span>
                </div>
              )}
            </div>
          )}

          {openInvoice && !openInvoice.cancellable && (
            <p className="text-xs text-[var(--color-neutral-700)] mt-2">
              This invoice already has a payment or credit applied, so it can&apos;t be cancelled here — review it separately if needed.
            </p>
          )}

          <p className="text-[13px] text-[var(--color-neutral-700)] mt-3">
            {showInvoiceDecision
              ? 'Decide the invoice now rather than after: leave it open if the family may still pay, or cancel it.'
              : 'You can reverse this from the Settings tab later.'}
          </p>

          {error && <div className="mt-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">{error}</div>}
        </div>
        <div className="p-6 border-t-2 border-[var(--color-ink)] flex flex-wrap items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="m-btn m-btn-outline m-btn-sm">Cancel</button>
          {showInvoiceDecision ? (
            <>
              <button onClick={() => handleConfirm(false)} disabled={loading || !preview} className="m-btn m-btn-outline m-btn-sm">
                {loading ? 'Working...' : 'Withdraw, keep invoice'}
              </button>
              <button onClick={() => handleConfirm(true)} disabled={loading || !preview} className="m-btn m-btn-danger m-btn-sm">
                {loading ? 'Working...' : 'Withdraw and cancel it'}
              </button>
            </>
          ) : (
            <button onClick={() => handleConfirm(false)} disabled={loading || !preview} className="m-btn m-btn-danger m-btn-sm">
              {loading ? 'Working...' : 'Withdraw'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ConfirmStatusModal({ studentId, studentName, action, onClose, onConfirmed, onResult }: {
  studentId: string
  studentName: string
  action: 'withdrawn' | 'graduated'
  onClose: () => void
  onConfirmed: () => void
  onResult: (result: { ok: boolean; message: string }) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{
    openInvoices: { id: string; invoiceNumber: string | null; totalAmount: number; outstandingAmount: number }[]
    invoicesNeedingReview: { id: string; invoiceNumber: string | null }[]
  } | null>(null)
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set())
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const canManageInvoices = useCan('manage-invoices')

  async function handleConfirm() {
    setError(null)
    setLoading(true)
    const result = await updateStudentStatus(studentId, action)
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      onResult({ ok: false, message: result.error })
      return
    }
    onResult({ ok: true, message: `${studentName} marked as ${action}.` })
    if (result.openInvoices.length > 0 || result.invoicesNeedingReview.length > 0) {
      setOutcome({ openInvoices: result.openInvoices, invoicesNeedingReview: result.invoicesNeedingReview })
      return
    }
    onConfirmed()
  }

  async function handleCancelInvoice(invoiceId: string) {
    setCancellingId(invoiceId)
    const result = await cancelInvoice(invoiceId)
    setCancellingId(null)
    if ('error' in result) {
      setError(result.error)
      onResult({ ok: false, message: result.error })
      return
    }
    setCancelledIds(prev => new Set(prev).add(invoiceId))
    onResult({ ok: true, message: 'Invoice cancelled.' })
  }

  if (outcome) {
    return (
      <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
        <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
          <div className="p-6">
            <h3 className="text-lg font-semibold text-[var(--color-ink)] mb-2">{studentName} marked as {action}</h3>
            <p className="text-sm text-[var(--color-neutral-700)] mb-3">
              This student has an invoice for the current term. Decide what to do with it - leave it open if the parent may still finish paying, or cancel it if not.
            </p>
            {error && <div className="mb-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">{error}</div>}
            {outcome.openInvoices.map(inv => {
              const isCancelled = cancelledIds.has(inv.id)
              return (
                <div key={inv.id} className="mb-3 p-3 border-2 border-[var(--color-neutral-300)] flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">{inv.invoiceNumber || 'Invoice'}</p>
                    <p className="text-xs text-[var(--color-neutral-700)] m-num">₦{inv.outstandingAmount.toLocaleString()} outstanding of ₦{inv.totalAmount.toLocaleString()}</p>
                  </div>
                  {isCancelled ? (
                    <span className="text-xs font-semibold text-[var(--color-signal-text)] shrink-0">Cancelled</span>
                  ) : canManageInvoices ? (
                    <button
                      onClick={() => handleCancelInvoice(inv.id)}
                      disabled={cancellingId === inv.id}
                      className="m-btn m-btn-sm border-2 border-[var(--color-signal)] text-[var(--color-signal-text)] hover:bg-[var(--color-signal-100)] disabled:opacity-50 shrink-0"
                    >
                      {cancellingId === inv.id ? 'Cancelling...' : 'Cancel invoice'}
                    </button>
                  ) : null}
                </div>
              )
            })}
            {outcome.invoicesNeedingReview.length > 0 && (
              <div className="mb-3 p-3 bg-[color-mix(in_srgb,var(--color-ochre)_10%,transparent)] border-l-[3px] border-[var(--color-ochre)] text-sm text-[var(--color-ochre-text)]">
                {outcome.invoicesNeedingReview.length === 1 ? 'This student has an invoice' : `This student has ${outcome.invoicesNeedingReview.length} invoices`} for this term with a payment or credit already applied, so it can&apos;t be cancelled here. Review it and issue a refund or credit if needed.
              </div>
            )}
          </div>
          <div className="p-6 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
            <button onClick={onConfirmed} className="m-btn m-btn-primary m-btn-sm">Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[var(--color-ink)] mb-2">
            Mark {studentName} as {action}?
          </h3>
          <p className="text-sm text-[var(--color-neutral-700)] mb-4">
            {action === 'withdrawn'
              ? 'This student will no longer appear in active lists. You can reverse this from the Settings tab later.'
              : 'This student will be moved to the graduates archive. You can reverse this from the Settings tab later.'}
          </p>
          {error && <div className="mb-4 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">{error}</div>}
        </div>
        <div className="p-6 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="m-btn m-btn-outline m-btn-sm">Cancel</button>
          <button onClick={handleConfirm} disabled={loading} className={`m-btn m-btn-sm ${action === 'withdrawn' ? 'm-btn-danger' : 'm-btn-primary'}`}>
            {loading ? 'Working...' : `Mark ${action}`}
          </button>
        </div>
      </div>
    </div>
  )
}
