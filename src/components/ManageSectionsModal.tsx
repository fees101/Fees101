'use client'

import { useState } from 'react'
import { updateSection, deleteSection } from '@/app/(app)/settings/academic-structure/actions'

interface Section {
  id: string
  name: string
}

interface Props {
  sections: Section[]
  onClose: () => void
  onSectionDeleted: (id: string) => void
  onSectionRenamed?: (id: string, name: string) => void
}

export default function ManageSectionsModal({ sections, onClose, onSectionDeleted, onSectionRenamed }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function startEditing(section: Section) {
    setError(null)
    setEditingId(section.id)
    setEditingName(section.name)
  }

  async function handleRename(sectionId: string) {
    setError(null)
    setSavingId(sectionId)
    const result = await updateSection(sectionId, editingName)
    if (result.error) {
      setError(result.error)
      setSavingId(null)
      return
    }
    onSectionRenamed?.(sectionId, editingName.trim())
    setEditingId(null)
    setSavingId(null)
  }

  async function handleDelete(sectionId: string) {
    setError(null)
    setDeletingId(sectionId)
    const result = await deleteSection(sectionId)
    if (result.error) {
      setError(result.error)
      setDeletingId(null)
      return
    }
    onSectionDeleted(sectionId)
    setDeletingId(null)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-navy">Manage sections</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {sections.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No sections to manage.</p>
          ) : (
            <div className="space-y-2">
              {sections.map(section => (
                <div key={section.id} className="p-3 border border-gray-200 rounded-lg">
                  {editingId === section.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                        className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                      />
                      <button
                        onClick={() => handleRename(section.id)}
                        disabled={savingId === section.id || !editingName.trim()}
                        className="text-xs text-mint font-medium hover:underline disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-navy">{section.name}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startEditing(section)}
                          className="text-xs text-gray-600 hover:underline"
                        >
                          Rename
                        </button>
                        <span className="text-gray-300">·</span>
                        <button
                          onClick={() => handleDelete(section.id)}
                          disabled={deletingId === section.id}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          {deletingId === section.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 flex items-center justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
