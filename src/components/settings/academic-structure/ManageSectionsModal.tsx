'use client'

import { useState } from 'react'
import { updateSection, deleteSection } from '@/app/(app)/school/academic-structure/actions'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'

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
  const [confirmDelete, setConfirmDelete] = useState<Section | null>(null)

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
    setConfirmDelete(null)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 m-anim-fade">
      <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]" onClick={onClose} />
      <div className="relative bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-sm w-full m-anim-scale">
        <div className="p-6 border-b-2 border-[var(--color-ink)] flex items-center justify-between">
          <h3 className="text-lg font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">Manage sections</h3>
          <button onClick={onClose} aria-label="Close" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
            Close
          </button>
        </div>

        <div className="p-6">
          {sections.length === 0 ? (
            <p className="text-sm text-[var(--color-neutral-700)] text-center py-4">No sections to manage.</p>
          ) : (
            <div className="border-2 border-[var(--color-neutral-300)] divide-y divide-[var(--color-neutral-300)]">
              {sections.map(section => (
                <div key={section.id} className="p-3">
                  {editingId === section.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                        className="m-input flex-1 min-w-0"
                      />
                      <button
                        onClick={() => handleRename(section.id)}
                        disabled={savingId === section.id || !editingName.trim()}
                        className="text-xs font-semibold text-[var(--color-ink)] hover:underline disabled:opacity-50 flex-shrink-0"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-[var(--color-neutral-700)] hover:underline flex-shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-[var(--color-ink)] truncate">{section.name}</span>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <button
                          onClick={() => startEditing(section)}
                          className="text-xs text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] hover:underline"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => { setError(null); setConfirmDelete(section) }}
                          disabled={deletingId === section.id}
                          className="text-xs font-semibold text-[var(--color-signal-text)] hover:underline disabled:opacity-50"
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
            <div className="mt-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 border-t-2 border-[var(--color-ink)] flex items-center justify-end">
          <button onClick={onClose} className="m-btn m-btn-outline">
            Done
          </button>
        </div>
      </div>

      {confirmDelete && (
        <DestructiveConfirmModal
          title={`Delete "${confirmDelete.name}"?`}
          description="Only goes through if no classes are currently assigned to it — otherwise you'll be told which ones to move first."
          note="This removes it from the section dropdown everywhere it's offered. There's no undo — you'd need to add it again from scratch."
          error={error}
          actions={[
            { label: 'Cancel', onClick: () => setConfirmDelete(null), variant: 'outline', disabled: deletingId === confirmDelete.id },
            { label: deletingId === confirmDelete.id ? 'Deleting...' : 'Delete', onClick: () => handleDelete(confirmDelete.id), variant: 'danger', disabled: deletingId === confirmDelete.id },
          ]}
        />
      )}
    </div>
  )
}
