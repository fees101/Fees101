'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AddClassPanel from './AddClassPanel'
import EditClassPanel from './EditClassPanel'
import { updateClass } from '@/app/(app)/fees/classes/actions'

interface ClassRow {
  id: string
  name: string
  displayOrder: number
  isActive: boolean
  sectionId: string
  sectionName: string
  studentCount: number
  feeItemCount: number
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
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-navy">Classes</h1>
          <p className="text-gray-500 mt-2 text-sm">
            {classes.filter(c => c.isActive).length} active {classes.filter(c => c.isActive).length === 1 ? 'class' : 'classes'}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
        >
          + Add class
        </button>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className={`grid gap-4 ${sidePanelOpen ? 'grid-cols-[1fr_380px]' : 'grid-cols-1'}`}>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {classes.length === 0 ? (
            <p className="p-12 text-center text-gray-500 text-sm">
              No classes yet. Click &quot;+ Add class&quot; to get started.
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3 w-16">Order</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Class</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Section</th>
                  <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Students</th>
                  <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Fee items</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Status</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {classes.map(cls => (
                  <tr key={cls.id} className={cls.isActive ? '' : 'opacity-50'}>
                    <td className="px-6 py-3 text-sm text-center text-gray-500">{cls.displayOrder}</td>
                    <td className="px-6 py-3 text-sm font-medium text-navy">{cls.name}</td>
                    <td className="px-6 py-3 text-sm text-gray-700">{cls.sectionName}</td>
                    <td className="px-6 py-3 text-sm text-center text-navy">{cls.studentCount}</td>
                    <td className="px-6 py-3 text-sm text-center text-navy">{cls.feeItemCount}</td>
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
              </tbody>
            </table>
          )}
        </div>

        {showAdd && (
          <AddClassPanel
            sections={sections}
            existingDisplayOrders={existingDisplayOrders}
            onClose={closeAdd}
            onSuccess={() => { closeAdd(); router.refresh() }}
          />
        )}

        {editingClass && (
          <EditClassPanel
            classData={editingClass}
            sections={sections}
            onClose={closeEdit}
            onSuccess={() => { closeEdit(); router.refresh() }}
          />
        )}

      </div>
    </>
  )
}