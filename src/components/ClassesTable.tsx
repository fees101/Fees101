'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AddClassModal from './AddClassModal'
import EditClassModal from './EditClassModal'
import { toggleClassActive } from '@/app/(app)/fees/classes/actions'

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
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  async function handleToggleActive(cls: ClassRow) {
    setToggleError(null)
    const result = await toggleClassActive(cls.id, !cls.isActive)
    if (result.error) {
      setToggleError(result.error)
      return
    }
    router.refresh()
  }

  const activeCount = classes.filter(c => c.isActive).length

  return (
    <>
      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy">Classes</h1>
          <p className="text-gray-500 mt-2 text-sm">
            {activeCount} active {activeCount === 1 ? 'class' : 'classes'} of {classes.length} total
          </p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-mint text-navy rounded-lg text-sm font-semibold hover:bg-mint/90 flex items-center gap-1"
        >
          + Add class
        </button>
      </header>

      {/* Toggle error */}
      {toggleError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {toggleError}
        </div>
      )}

      {/* Classes table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {classes.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500 text-sm mb-4">No classes yet.</p>
            <button 
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-mint text-navy rounded-lg text-sm font-semibold hover:bg-mint/90"
            >
              + Add your first class
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Class name</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Section</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Display order</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Students</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Fee items</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {classes.map(cls => (
                  <tr key={cls.id} className={`hover:bg-gray-50 ${!cls.isActive ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 text-sm font-medium text-navy">{cls.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{cls.sectionName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{cls.displayOrder}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{cls.studentCount}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{cls.feeItemCount}</td>
                    <td className="px-4 py-3">
                      {cls.isActive ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium bg-mint-light text-mint rounded-full">
                          <span className="w-1.5 h-1.5 bg-mint rounded-full"></span>
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                          <span className="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => setEditingClass(cls)}
                          className="text-mint text-xs font-medium hover:underline"
                        >
                          Edit
                        </button>
                        <span className="text-gray-300">·</span>
                        <button
                          onClick={() => handleToggleActive(cls)}
                          className={`text-xs font-medium hover:underline ${cls.isActive ? 'text-red-600' : 'text-mint'}`}
                        >
                          {cls.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddClassModal
          sections={sections}
          existingDisplayOrders={classes.map(c => c.displayOrder)}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); router.refresh() }}
        />
      )}

      {editingClass && (
        <EditClassModal
          classData={editingClass}
          sections={sections}
          onClose={() => setEditingClass(null)}
          onSuccess={() => { setEditingClass(null); router.refresh() }}
        />
      )}
    </>
  )
}