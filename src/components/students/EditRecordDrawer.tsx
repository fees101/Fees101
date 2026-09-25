'use client'

import { useState } from 'react'
import StudentSettingsTab from './StudentSettingsTab'

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
}

// The "Edit record" trigger + its slide-in drawer — same shell as
// AddStudentModal's right-side panel (backdrop + fixed-width ink-bordered
// aside), so editing a student's record no longer needs its own always-open
// section at the bottom of the page.
export default function EditRecordDrawer({ student }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)} className="m-btn m-btn-outline w-full mt-3.5">
        Edit record
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex m-anim-fade">
          <div
            className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
            onClick={() => setOpen(false)}
          />
          <aside
            style={{ width: '420px', maxWidth: '100%' }}
            className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
          >
            <div className="flex items-start justify-between gap-4 mb-1">
              <h3 className="text-[22px] font-extrabold">Edit record</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] flex-shrink-0"
              >
                Close
              </button>
            </div>
            <p className="text-[14px] text-[var(--color-neutral-800)] mb-5">
              Update details, family information and notes below, then save each section.
            </p>
            <StudentSettingsTab student={student} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  )
}
