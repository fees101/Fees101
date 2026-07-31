'use client'

import { Fragment, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AddClassPanel from './AddClassPanel'
import EditClassPanel from './EditClassPanel'
import { updateClass } from '@/app/(app)/settings/academic-structure/actions'

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
    if (!cls.nextClassId) return <span className="text-amber-600">Exits school</span>
    return classNameById[cls.nextClassId] || <span className="text-gray-400 italic">Unknown class</span>
  }

  async function handleDeactivate(cls: ClassRow) {
    setError(null)
    if (cls.studentCount > 0) {
      setError(`Cannot deactivate ${cls.name} — it has ${cls.studentCount} active ${cls.studentCount === 1 ? 'student' : 'students'}. Move them to another class first.`)
      return
    }
    if (!confirm(`Deactivate ${cls.name}?`)) return
    const result = await updateClass(cls.id, {
      name: cls.name,
      sectionId: cls.sectionId,
      displayOrder: cls.displayOrder,
      isActive: false,
    })
    if (result.error) {
      setError(result.error)
      return
    }
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

  const sidePanelOpen = showAdd || editingClass !== null

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          {classes.filter(c => c.isActive).length} active {classes.filter(c => c.isActive).length === 1 ? 'class' : 'classes'}
        </p>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 flex-shrink-0"
        >
          + Add class
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className={`grid gap-4 ${sidePanelOpen ? 'grid-cols-1 lg:grid-cols-[1fr_380px]' : 'grid-cols-1'}`}>

        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          {classes.length === 0 && sections.length === 0 ? (
            <p className="p-12 text-center text-gray-500 text-sm">
              No sections or classes yet. Add a section on the Sections tab, then &quot;+ Add class&quot; here.
            </p>
          ) : (
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3 w-16">Order</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Class</th>
                  <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Students</th>
                  <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Fee items</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Promotes to</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Status</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {groupedBySection.map(({ section, classes: sectionClasses }) => (
                  <Fragment key={section.id}>
                    <tr className="bg-gray-50/70">
                      <td colSpan={7} className="px-6 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {section.name} <span className="text-gray-400 font-normal normal-case">({sectionClasses.length})</span>
                      </td>
                    </tr>
                    {sectionClasses.length === 0 ? (
                      <tr key={`empty-${section.id}`}>
                        <td colSpan={7} className="px-6 py-4 text-sm text-gray-400 italic text-center">
                          No classes in this section yet.
                        </td>
                      </tr>
                    ) : (
                      sectionClasses.map(cls => (
                        <tr key={cls.id} className={cls.isActive ? '' : 'opacity-50'}>
                          <td className="px-6 py-3 text-sm text-center text-gray-500">{cls.displayOrder}</td>
                          <td className="px-6 py-3 text-sm font-medium text-navy">{cls.name}</td>
                          <td className="px-6 py-3 text-sm text-center text-navy">{cls.studentCount}</td>
                          <td className="px-6 py-3 text-sm text-center text-navy">{cls.feeItemCount}</td>
                          <td className="px-6 py-3 text-sm text-navy">{promotesToLabel(cls)}</td>
                          <td className="px-6 py-3">
                            {cls.isActive ? (
                              <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-mint-light text-mint rounded-full">
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                                Inactive
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() => openEdit(cls)}
                                className="text-xs text-mint font-medium hover:underline"
                              >
                                Edit
                              </button>
                              {cls.isActive && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <button
                                    onClick={() => handleDeactivate(cls)}
                                    className="text-xs text-red-600 font-medium hover:underline"
                                  >
                                    Deactivate
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </Fragment>
                ))}

                {orphanedClasses.length > 0 && (
                  <>
                    <tr className="bg-gray-50/70">
                      <td colSpan={7} className="px-6 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        No section <span className="text-gray-400 font-normal normal-case">({orphanedClasses.length})</span>
                      </td>
                    </tr>
                    {orphanedClasses.map(cls => (
                      <tr key={cls.id} className={cls.isActive ? '' : 'opacity-50'}>
                        <td className="px-6 py-3 text-sm text-center text-gray-500">{cls.displayOrder}</td>
                        <td className="px-6 py-3 text-sm font-medium text-navy">{cls.name}</td>
                        <td className="px-6 py-3 text-sm text-center text-navy">{cls.studentCount}</td>
                        <td className="px-6 py-3 text-sm text-center text-navy">{cls.feeItemCount}</td>
                        <td className="px-6 py-3 text-sm text-navy">{promotesToLabel(cls)}</td>
                        <td className="px-6 py-3">
                          {cls.isActive ? (
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-mint-light text-mint rounded-full">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => openEdit(cls)}
                              className="text-xs text-mint font-medium hover:underline"
                            >
                              Edit
                            </button>
                            {cls.isActive && (
                              <>
                                <span className="text-gray-300">·</span>
                                <button
                                  onClick={() => handleDeactivate(cls)}
                                  className="text-xs text-red-600 font-medium hover:underline"
                                >
                                  Deactivate
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>

        {showAdd && (
          <AddClassPanel
            sections={sections}
            existingDisplayOrders={existingDisplayOrders}
            allClasses={classes}
            onClose={closeAdd}
            onSuccess={() => { closeAdd(); router.refresh() }}
          />
        )}

        {editingClass && (
          <EditClassPanel
            classData={editingClass}
            sections={sections}
            allClasses={classes}
            onClose={closeEdit}
            onSuccess={() => { closeEdit(); router.refresh() }}
          />
        )}

      </div>
    </>
  )
}
