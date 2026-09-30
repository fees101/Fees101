'use client'

import { useState } from 'react'
import { updateClass, addSection, deleteSection } from '@/app/(app)/school/academic-structure/actions'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'

interface ClassRow {
  id: string
  name: string
  displayOrder: number
  isActive: boolean
  sectionId: string
  nextClassId?: string | null
}

interface Section {
  id: string
  name: string
}

interface ClassOption {
  id: string
  name: string
}

interface Props {
  classData: ClassRow
  sections: Section[]
  allClasses: ClassOption[]
  onClose: () => void
  onSuccess: () => void
}

export default function EditClassPanel({ classData, sections: initialSections, allClasses, onClose, onSuccess }: Props) {
  const [sections, setSections] = useState<Section[]>(initialSections)
  const [form, setForm] = useState({
    name: classData.name,
    sectionId: classData.sectionId,
    displayOrder: classData.displayOrder,
    isActive: classData.isActive,
    nextClassId: classData.nextClassId || '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showAddSection, setShowAddSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')
  const [addingSectionLoading, setAddingSectionLoading] = useState(false)
  const [sectionError, setSectionError] = useState<string | null>(null)
  const [showManageSections, setShowManageSections] = useState(false)

  async function handleAddSection() {
    if (!newSectionName.trim()) return
    setSectionError(null)
    setAddingSectionLoading(true)
    const result = await addSection(newSectionName)
    if (result.error) {
      setSectionError(result.error)
      setAddingSectionLoading(false)
      return
    }
    if (result.section) {
      const newSection = { id: result.section.id, name: result.section.name }
      setSections([...sections, newSection])
      setForm({ ...form, sectionId: newSection.id })
    }
    setNewSectionName('')
    setShowAddSection(false)
    setAddingSectionLoading(false)
  }

  function handleSectionDeleted(deletedId: string) {
    const updatedSections = sections.filter(s => s.id !== deletedId)
    setSections(updatedSections)
    if (form.sectionId === deletedId) {
      setForm({ ...form, sectionId: updatedSections[0]?.id || '' })
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      setError('Class name is required')
      return
    }
    setError(null)
    setLoading(true)
    const result = await updateClass(classData.id, { ...form, nextClassId: form.nextClassId || null })
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    onSuccess()
  }

  return (
    <>
      <div className="border-2 border-[var(--color-ink)] flex flex-col m-anim-slab">
        <div className="p-5 border-b-2 border-[var(--color-ink)] flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">Edit class</h3>
          <button onClick={onClose} aria-label="Close" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
            Close
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="m-label">Class name <span className="text-[var(--color-signal-text)]">*</span></span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({...form, name: e.target.value})}
              className="m-input"
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="m-label !mb-0">Section</span>
              {sections.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowManageSections(true)}
                  className="text-xs text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] hover:underline"
                >
                  Manage sections
                </button>
              )}
            </div>
            {sections.length > 0 ? (
              <select
                value={form.sectionId}
                onChange={(e) => setForm({...form, sectionId: e.target.value})}
                className="m-select"
              >
                {sections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-[var(--color-neutral-500)] italic py-2">No sections yet.</p>
            )}

            {showAddSection ? (
              <div className="mt-2 p-3 border-2 border-[var(--color-neutral-300)]">
                <label className="block">
                  <span className="m-label">New section name</span>
                  <input
                    type="text"
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    placeholder="e.g. Primary, Secondary, Nursery"
                    className="m-input"
                    autoFocus
                  />
                </label>
                {sectionError && (
                  <p className="text-xs text-[var(--color-signal-text)] mt-1">{sectionError}</p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <button
                    type="button"
                    onClick={handleAddSection}
                    disabled={addingSectionLoading || !newSectionName.trim()}
                    className="m-btn m-btn-primary m-btn-sm"
                  >
                    {addingSectionLoading ? 'Adding...' : 'Add section'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddSection(false); setNewSectionName(''); setSectionError(null) }}
                    className="m-btn m-btn-outline m-btn-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddSection(true)}
                className="mt-2 text-xs font-semibold text-[var(--color-ink)] hover:underline"
              >
                + Add new section
              </button>
            )}
          </div>

          <label className="block">
            <span className="m-label">Display order</span>
            <input
              type="number"
              value={form.displayOrder}
              onChange={(e) => setForm({...form, displayOrder: parseInt(e.target.value) || 0})}
              className="m-input"
            />
          </label>

          <label className="block">
            <span className="m-label">Promotes to</span>
            <select
              value={form.nextClassId}
              onChange={(e) => setForm({...form, nextClassId: e.target.value})}
              className="m-select"
            >
              <option value="">— Exits school (graduates) —</option>
              {allClasses.filter(c => c.id !== classData.id).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-xs text-[var(--color-neutral-700)] mt-1">Where students in this class move to at year-end rollover. Leave as &quot;Exits school&quot; if this is a graduating class.</p>
          </label>

          <div className="flex items-center justify-between pt-3 border-t border-[var(--color-neutral-300)]">
            <div>
              <p className="text-sm font-medium text-[var(--color-ink)]">Active</p>
              <p className="text-xs text-[var(--color-neutral-700)]">Inactive classes are hidden from forms</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.isActive}
              aria-label="Active"
              onClick={() => setForm({...form, isActive: !form.isActive})}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center border-2 transition-colors ${
                form.isActive ? 'bg-[var(--color-ink)] border-[var(--color-ink)]' : 'bg-transparent border-[var(--color-neutral-400)]'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform transition-transform ${
                  form.isActive ? 'translate-x-[18px] bg-[var(--color-paper)]' : 'translate-x-0.5 bg-[var(--color-neutral-500)]'
                }`}
              />
            </button>
          </div>

          {error && (
            <div className="p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {error}
            </div>
          )}
        </div>

        <div className="p-5 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} disabled={loading} className="m-btn m-btn-outline">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="m-btn m-btn-primary"
          >
            {loading ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      {showManageSections && (
        <ManageSectionsModal
          sections={sections}
          onClose={() => setShowManageSections(false)}
          onSectionDeleted={handleSectionDeleted}
        />
      )}
    </>
  )
}

function ManageSectionsModal({ sections, onClose, onSectionDeleted }: {
  sections: Section[]
  onClose: () => void
  onSectionDeleted: (id: string) => void
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Section | null>(null)

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
                <div key={section.id} className="flex items-center justify-between p-3">
                  <span className="text-sm text-[var(--color-ink)]">{section.name}</span>
                  <button
                    onClick={() => { setError(null); setConfirmDelete(section) }}
                    disabled={deletingId === section.id}
                    className="text-xs font-semibold text-[var(--color-signal-text)] hover:underline disabled:opacity-50"
                  >
                    {deletingId === section.id ? 'Deleting...' : 'Delete'}
                  </button>
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
