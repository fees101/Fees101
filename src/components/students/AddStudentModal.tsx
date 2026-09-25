'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { addStudent } from '@/app/(app)/students/actions'

interface Class {
  id: string
  name: string
}

interface AddStudentModalProps {
  classes: Class[]
  onClose: () => void
  onSuccess: () => void
}

// One field per row, flush left — the App Shell "Add a student" drawer. Hints sit
// under the fields that carry a consequence (class sets the fees, phone gates SMS,
// email gates the PDF); the plain ones get none.
export default function AddStudentModal({ classes, onClose, onSuccess }: AddStudentModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A duplicate admission number is a field-level conflict: the message sits on
  // the admission field and links to the record already holding it, rather than
  // a generic form-foot error.
  const [admissionConflict, setAdmissionConflict] = useState<{ message: string; id: string; name: string } | null>(null)
  const [showSecondary, setShowSecondary] = useState(false)
  const [confirmFamily, setConfirmFamily] = useState<{ input: Parameters<typeof addStudent>[0]; existingFamilyName: string } | null>(null)

  async function submit(input: Parameters<typeof addStudent>[0]) {
    setLoading(true)
    setError(null)
    setAdmissionConflict(null)

    const result = await addStudent(input)

    if ('needsConfirmation' in result && result.needsConfirmation) {
      setLoading(false)
      setConfirmFamily({ input, existingFamilyName: result.existingFamilyName })
      return
    }

    if ('error' in result && result.error) {
      if ('conflict' in result && result.conflict) {
        setAdmissionConflict({ message: result.error, id: result.conflict.id, name: result.conflict.name })
      } else {
        setError(result.error)
      }
      setLoading(false)
      return
    }

    onSuccess()
  }

  // Plain onSubmit + preventDefault, not the form `action` prop: React 19
  // auto-resets an action form once the action resolves, which would wipe
  // everything the user typed the moment a validation error (e.g. a duplicate
  // admission number) comes back — exactly when they need it kept to fix it.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    await submit({
      firstName: formData.get('firstName') as string,
      lastName: formData.get('lastName') as string,
      admissionNumber: formData.get('admissionNumber') as string,
      classId: formData.get('classId') as string,
      admissionDate: formData.get('admissionDate') as string,
      primaryParentName: formData.get('primaryParentName') as string,
      primaryParentPhone: formData.get('primaryParentPhone') as string,
      primaryParentEmail: (formData.get('primaryParentEmail') as string) || undefined,
      secondaryParentName: (formData.get('secondaryParentName') as string) || undefined,
      secondaryParentPhone: (formData.get('secondaryParentPhone') as string) || undefined,
      secondaryParentEmail: (formData.get('secondaryParentEmail') as string) || undefined,
    })
  }

  function handleConfirmSameFamily() {
    if (!confirmFamily) return
    const input = confirmFamily.input
    setConfirmFamily(null)
    submit({ ...input, confirmFamilyLink: true })
  }

  const today = new Date().toISOString().split('T')[0]

  const labelCls = 'block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink)] mb-1.5'
  const hintCls = 'block text-[12px] text-[var(--color-neutral-700)] mt-1'
  const req = <span className="text-[var(--color-signal-text)]">*</span>

  return (
    <div className="fixed inset-0 z-50 flex m-anim-fade">
      {/* Backdrop covers everything left of the drawer */}
      <div
        className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
        onClick={onClose}
      />

      {/* Right-side drawer. Width is inline (not w-[420px]) because the WASM
          Tailwind build doesn't emit arbitrary width utilities reliably. */}
      <aside
        style={{ width: '420px', maxWidth: '100%' }}
        className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">Add a student</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
          >
            Close
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--color-neutral-800)] mb-5">
          One column, flush left. The fields marked with a mark are required — everything else can be filled in
          later from the student&apos;s profile.
        </p>

        <form onSubmit={handleSubmit} className="border-t-2 border-[var(--color-ink)] pt-4">
          <label className="block mb-3.5">
            <span className={labelCls}>First name {req}</span>
            <input type="text" name="firstName" required placeholder="Chidinma" className="m-input w-full box-border" />
          </label>

          <label className="block mb-3.5">
            <span className={labelCls}>Last name {req}</span>
            <input type="text" name="lastName" required placeholder="Adebayo" className="m-input w-full box-border" />
          </label>

          <label className="block mb-3.5">
            <span className={labelCls}>Class {req}</span>
            <select name="classId" required defaultValue="" className="m-select w-full box-border">
              <option value="" disabled>Select class</option>
              {classes.map(cls => (
                <option key={cls.id} value={cls.id}>{cls.name}</option>
              ))}
            </select>
            <span className={hintCls}>Sets which fees apply.</span>
          </label>

          <label className="block mb-3.5">
            <span className={labelCls}>Admission number {req}</span>
            <input
              type="text"
              name="admissionNumber"
              required
              placeholder="GA/2026/0649"
              aria-invalid={admissionConflict ? true : undefined}
              onChange={() => admissionConflict && setAdmissionConflict(null)}
              className="m-input w-full box-border"
              style={admissionConflict ? { borderColor: 'var(--color-ochre)' } : undefined}
            />
            {admissionConflict ? (
              /* On-field conflict: name it, and link to the record that holds it.
                 Opens in a new tab so the half-filled form is not lost. Ochre, not
                 red: a clash is a human decision (duplicate or typo?), not a system
                 failure — matching the canvas's `rule: ochre` for VALIDATION and the
                 definition-of-done's "ochre = needs a human". No tinted fill. */
              <span className="block mt-1.5 pl-2.5 text-[13px] leading-[1.5] text-[var(--color-ochre-text)]" style={{ borderLeft: '2px solid var(--color-ochre)' }}>
                {admissionConflict.message}. It belongs to{' '}
                <Link href={`/students/${admissionConflict.id}`} target="_blank" className="font-semibold underline">
                  {admissionConflict.name} →
                </Link>
                . Check whether this is a duplicate or a typo.
              </span>
            ) : (
              <span className={hintCls}>Must be unique.</span>
            )}
          </label>

          <label className="block mb-3.5">
            <span className={labelCls}>Parent name {req}</span>
            <input type="text" name="primaryParentName" required placeholder="Mr Adebayo Kunle" className="m-input w-full box-border" />
          </label>

          <label className="block mb-3.5">
            <span className={labelCls}>Parent phone {req}</span>
            <input type="tel" name="primaryParentPhone" required placeholder="0803 441 2290" className="m-input w-full box-border" />
            <span className={hintCls}>Where reminders go. Without it, no SMS can be sent.</span>
          </label>

          <label className="block mb-3.5">
            <span className={labelCls}>Parent email</span>
            <input type="email" name="primaryParentEmail" placeholder="kunle@example.com" className="m-input w-full box-border" />
            <span className={hintCls}>Optional, but the invoice PDF needs it.</span>
          </label>

          <label className="block mb-3.5">
            <span className={labelCls}>Admission date</span>
            <input type="date" name="admissionDate" defaultValue={today} className="m-input w-full box-border" />
          </label>

          {/* Secondary parent — collapsed by default, flush-left toggle (kept for
              parity with the existing flow; the App Shell drawer omits it). */}
          {!showSecondary ? (
            <button
              type="button"
              onClick={() => setShowSecondary(true)}
              className="text-[13px] font-semibold text-[var(--color-ink)] hover:underline mb-1"
            >
              Add a secondary parent
            </button>
          ) : (
            <div className="border-t border-[var(--color-neutral-300)] pt-4 mt-1">
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink)]">Secondary parent</span>
                <button
                  type="button"
                  onClick={() => setShowSecondary(false)}
                  className="text-[12px] text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]"
                >
                  Remove
                </button>
              </div>
              <label className="block mb-3.5">
                <span className={labelCls}>Parent name</span>
                <input type="text" name="secondaryParentName" placeholder="Mrs Adebayo" className="m-input w-full box-border" />
              </label>
              <label className="block mb-3.5">
                <span className={labelCls}>Parent phone</span>
                <input type="tel" name="secondaryParentPhone" placeholder="0803 441 2290" className="m-input w-full box-border" />
              </label>
              <label className="block mb-3.5">
                <span className={labelCls}>Parent email</span>
                <input type="email" name="secondaryParentEmail" placeholder="parent@example.com" className="m-input w-full box-border" />
              </label>
            </div>
          )}

          {error && (
            <div className="mt-2 mb-1 pl-3 py-1 border-l-2 border-[var(--color-signal)] text-[13px] text-[var(--color-signal-text)]">
              {error}
            </div>
          )}

          {/* Billing note + action */}
          <div className="border-t border-[var(--color-neutral-300)] pt-3.5 mt-2">
            <p className="text-[13px] leading-relaxed text-[var(--color-neutral-800)] mb-3">
              Adding a student does not bill them. If invoices for the current term have already been generated, this
              student is picked up by the next generation run, or you can invoice them on their own from the profile.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={loading} className="m-btn m-btn-primary flex-1 min-w-[130px]">
                {loading ? 'Adding…' : 'Add student'}
              </button>
              <button type="button" onClick={onClose} className="m-btn m-btn-outline flex-1 min-w-[130px]">
                Cancel
              </button>
            </div>
          </div>
        </form>
      </aside>

      {/* Name-mismatch confirmation — phone matches an existing family under a different name */}
      {confirmFamily && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 m-anim-fade">
          <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]" />
          <div className="relative bg-[var(--color-paper)] border-2 border-[var(--color-ink)] w-full max-w-md p-6 m-anim-scale">
            <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-2">Same family as an existing parent?</h3>
            <p className="text-sm text-[var(--color-neutral-700)] mb-4">
              A family with this phone number is already on file under the name{' '}
              <span className="font-semibold text-[var(--color-ink)]">&ldquo;{confirmFamily.existingFamilyName}&rdquo;</span>.
              If this student is a sibling, linking them will also apply any sibling discount this family qualifies for.
              If the number was mistyped or belongs to a different family, go back and check it.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmFamily(null)}
                className="m-btn m-btn-outline"
              >
                Let me check the number
              </button>
              <button
                type="button"
                onClick={handleConfirmSameFamily}
                disabled={loading}
                className="m-btn m-btn-primary"
              >
                {loading ? 'Adding…' : 'Yes, same family'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
