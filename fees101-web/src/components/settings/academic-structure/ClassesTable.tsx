'use client'

import { Fragment, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AddClassPanel from './AddClassPanel'
import EditClassPanel from './EditClassPanel'
import { updateClass } from '@/app/(app)/school/academic-structure/actions'
import Toast from '@/components/ui/Toast'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'

interface ClassRow {
  id: string
  name: string
  displayOrder: number
  isActive: boolean
  sectionId: string
  sectionName: string
  studentCount: number
  feeItemCount: number
  nextClassId?: string | null
}

interface Section {
  id: string
  name: string
}

interface Props {
  classes: ClassRow[]
  sections: Section[]
}

export default function ClassesTable({ classes, sections }: Props) {
  const router = useRouter()
  const [showAdd, setShowAdd] = useState(false)
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)
  const [deactivateConfirm, setDeactivateConfirm] = useState<ClassRow | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  const existingDisplayOrders = classes.map(c => c.displayOrder)

  // sections is already ordered by display_order — group classes under each
  // section in that order rather than trusting the flat classes list to be
  // contiguous by section.
  const groupedBySection = useMemo(() => {
    return sections
      .map(section => ({
        section,
        classes: classes
          .filter(c => c.sectionId === section.id)
          .sort((a, b) => a.displayOrder - b.displayOrder),
      }))
  }, [classes, sections])

  const orphanedClasses = useMemo(
    () => classes.filter(c => !sections.some(s => s.id === c.sectionId)),
    [classes, sections]
  )

  const classNameById = useMemo(() => {
    const map: Record<string, string> = {}
    classes.forEach(c => { map[c.id] = c.name })
    return map
  }, [classes])

  function promotesToLabel(cls: ClassRow) {
    if (!cls.nextClassId) return <span className="text-[var(--color-ochre-text)]">Exits school</span>
    return classNameById[cls.nextClassId] || <span className="text-[var(--color-neutral-500)] italic">Unknown class</span>
  }

  async function handleDeactivate(cls: ClassRow) {
    setError(null)
    if (cls.studentCount > 0) {
      setError(`Cannot deactivate ${cls.name} — it has ${cls.studentCount} active ${cls.studentCount === 1 ? 'student' : 'students'}. Move them to another class first.`)
      return
    }
    setDeactivateError(null)
    setDeactivateConfirm(cls)
  }

  async function confirmDeactivate() {
    if (!deactivateConfirm) return
    const cls = deactivateConfirm
    setDeactivating(true)
    setDeactivateError(null)
    const result = await updateClass(cls.id, {
      name: cls.name,
      sectionId: cls.sectionId,
      displayOrder: cls.displayOrder,
      isActive: false,
    })
    setDeactivating(false)
    if (result.error) {
      setDeactivateError(result.error)
      return
    }
    setDeactivateConfirm(null)
    setToast({ ok: true, message: `${cls.name} deactivated.` })
    router.refresh()
  }

  function openAdd() {
    setEditingClass(null)
    setShowAdd(true)
  }

  function openEdit(cls: ClassRow) {
    setShowAdd(false)
    setEditingClass(cls)
  }

  function closeAdd() {
    setShowAdd(false)
  }

  function closeEdit() {
    setEditingClass(null)
  }

  function renderRow(cls: ClassRow) {
    return (
      <tr key={cls.id} className={cls.isActive ? '' : 'opacity-50'}>
        <td className="text-center m-num">{cls.displayOrder}</td>
        <td className="font-medium text-[var(--color-ink)]">{cls.name}</td>
        <td className="text-center m-num">{cls.studentCount}</td>
        <td className="text-center m-num">{cls.feeItemCount}</td>
        <td>{promotesToLabel(cls)}</td>
        <td>
          {cls.isActive ? (
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink)]">Active</span>
          ) : (
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-500)]">Inactive</span>
          )}
        </td>
        <td className="text-right">
          <div className="inline-flex items-center gap-3">
            <button
              onClick={() => openEdit(cls)}
              className="text-xs font-semibold text-[var(--color-ink)] hover:underline"
            >
              Edit
            </button>
            {cls.isActive && (
              <button
                onClick={() => handleDeactivate(cls)}
                className="text-xs font-semibold text-[var(--color-signal-text)] hover:underline"
              >
                Deactivate
              </button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  if (showAdd) {
    return (
      <AddClassPanel
        sections={sections}
        existingDisplayOrders={existingDisplayOrders}
        allClasses={classes}
        onClose={closeAdd}
        onSuccess={() => { closeAdd(); router.refresh() }}
      />
    )
  }

  if (editingClass) {
    return (
      <EditClassPanel
        classData={editingClass}
        sections={sections}
        allClasses={classes}
        onClose={closeEdit}
        onSuccess={() => { closeEdit(); router.refresh() }}
      />
    )
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-[var(--color-neutral-700)] m-num">
          {classes.filter(c => c.isActive).length} active {classes.filter(c => c.isActive).length === 1 ? 'class' : 'classes'}
        </p>
        <button
          onClick={openAdd}
          className="m-btn m-btn-primary m-btn-sm flex-shrink-0"
        >
          + Add class
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
          {error}
        </div>
      )}

      <div className="border-2 border-[var(--color-ink)] overflow-x-auto">
        {classes.length === 0 && sections.length === 0 ? (
          <p className="p-12 text-center text-sm text-[var(--color-neutral-700)]">
            No sections or classes yet. Add a section on the Sections tab, then &quot;+ Add class&quot; here.
          </p>
        ) : (
          <table className="m-table min-w-[640px]">
            <thead>
              <tr>
                <th className="text-center w-16">Order</th>
                <th>Class</th>
                <th className="text-center">Students</th>
                <th className="text-center">Fee items</th>
                <th>Promotes to</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedBySection.map(({ section, classes: sectionClasses }) => (
                <Fragment key={section.id}>
                  <tr className="bg-[var(--color-surface)]">
                    <td colSpan={7} className="text-xs font-semibold text-[var(--color-neutral-700)] uppercase tracking-wider">
                      {section.name} <span className="text-[var(--color-neutral-500)] font-normal normal-case">({sectionClasses.length})</span>
                    </td>
                  </tr>
                  {sectionClasses.length === 0 ? (
                    <tr key={`empty-${section.id}`}>
                      <td colSpan={7} className="text-sm text-[var(--color-neutral-500)] italic text-center">
                        No classes in this section yet.
                      </td>
                    </tr>
                  ) : (
                    sectionClasses.map(cls => renderRow(cls))
                  )}
                </Fragment>
              ))}

              {orphanedClasses.length > 0 && (
                <>
                  <tr className="bg-[var(--color-surface)]">
                    <td colSpan={7} className="text-xs font-semibold text-[var(--color-neutral-700)] uppercase tracking-wider">
                      No section <span className="text-[var(--color-neutral-500)] font-normal normal-case">({orphanedClasses.length})</span>
                    </td>
                  </tr>
                  {orphanedClasses.map(cls => renderRow(cls))}
                </>
              )}
            </tbody>
          </table>
        )}
      </div>

      {toast && <Toast message={toast.message} ok={toast.ok} onDismiss={() => setToast(null)} />}

      {deactivateConfirm && (
        <DestructiveConfirmModal
          title={`Deactivate ${deactivateConfirm.name}?`}
          description="Hides this class from the dropdowns used when adding a student or setting up a new term's fees."
          rows={[
            { label: 'Fee items already set up for this class', value: deactivateConfirm.feeItemCount, emphasize: true },
          ]}
          note="Those existing fee items stay as they are — you just can't add new ones here until it's reactivated. Reactivate anytime from Edit."
          error={deactivateError}
          actions={[
            { label: 'Cancel', onClick: () => setDeactivateConfirm(null), variant: 'outline', disabled: deactivating },
            { label: deactivating ? 'Deactivating...' : 'Deactivate', onClick: confirmDeactivate, variant: 'danger', disabled: deactivating },
          ]}
        />
      )}
    </>
  )
}
