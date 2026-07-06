'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addSection, updateSection, deleteSection } from '@/app/(app)/settings/academic-structure/actions'
import ConfirmDialog from '@/components/ConfirmDialog'

interface Section {
  id: string
  name: string
}

interface Props {
  sections: Section[]
  classCounts: Record<string, number>
}

export default function SectionsTab({ sections, classCounts }: Props) {
  const router = useRouter()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Section | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    if (!newName.trim()) return
    setError(null)
    setAdding(true)
    const result = await addSection(newName)
    setAdding(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setNewName('')
    setShowAdd(false)
    router.refresh()
  }

  function startEditing(section: Section) {
    setError(null)
    setEditingId(section.id)
    setEditingName(section.name)
  }

  async function handleRename(sectionId: string) {
    setError(null)
    setSavingId(sectionId)
    const result = await updateSection(sectionId, editingName)
    setSavingId(null)
    if (result.error) {
      setError(result.error)
      return
    }
    setEditingId(null)
    router.refresh()
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setError(null)
    setDeletingId(confirmDelete.id)
    const result = await deleteSection(confirmDelete.id)
    setDeletingId(null)
    setConfirmDelete(null)
    if (result.error) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between gap-4 mb-1">
          <h2 className="text-navy font-semibold text-lg">Sections</h2>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 flex-shrink-0"
          >
            + Add section
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Groups of classes, like Nursery, Primary, and Secondary. Shown as headings when browsing classes and students.
        </p>

        {showAdd && (
          <div className="mb-4 p-3 bg-mint-light/30 border border-mint/20 rounded-lg flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Nursery"
              autoFocus
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleAdd}
                disabled={adding || !newName.trim()}
                className="px-3 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
              >
                {adding ? 'Adding...' : 'Add'}
              </button>
              <button
                onClick={() => { setShowAdd(false); setNewName(''); setError(null) }}
                className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {sections.length === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-8">No sections yet.</p>
        ) : (
          <div className="space-y-2">
            {sections.map(section => (
              <div key={section.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 border border-gray-200 rounded-lg">
                {editingId === section.id ? (
                  <div className="flex flex-1 min-w-0 flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                    />
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleRename(section.id)}
                        disabled={savingId === section.id || !editingName.trim()}
                        className="text-xs text-mint font-medium hover:underline disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:underline">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-sm font-medium text-navy truncate">{section.name}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {classCounts[section.id] || 0} {classCounts[section.id] === 1 ? 'class' : 'classes'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => startEditing(section)} className="text-xs text-gray-600 hover:underline">
                        Rename
                      </button>
                      <span className="text-gray-300">·</span>
                      <button
                        onClick={() => setConfirmDelete(section)}
                        disabled={deletingId === section.id}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.name}"?`}
          message="This can't be undone. Sections with classes still assigned can't be deleted — move those classes first."
          destructive
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
