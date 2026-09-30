'use client'

import { useState } from 'react'
import { addClass, addSection } from '@/app/(app)/school/academic-structure/actions'
import ManageSectionsModal from './ManageSectionsModal'

interface Section {
  id: string
  name: string
}

interface ClassOption {
  id: string
  name: string
}

interface Props {
  sections: Section[]
  existingDisplayOrders: number[]
  allClasses: ClassOption[]
  onClose: () => void
  onSuccess: () => void
}

export default function AddClassPanel({ sections: initialSections, existingDisplayOrders, allClasses, onClose, onSuccess }: Props) {
  const maxOrder = existingDisplayOrders.length > 0 ? Math.max(...existingDisplayOrders) : 0

  const [sections, setSections] = useState<Section[]>(initialSections)
  const [form, setForm] = useState({
    name: '',
    sectionId: initialSections[0]?.id || '',
    displayOrder: maxOrder + 1,
    nextClassId: '' as string,
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

  function handleSectionRenamed(id: string, name: string) {
    setSections(sections.map(s => s.id === id ? { ...s, name } : s))
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      setError('Class name is required')
      return
    }
    if (!form.sectionId) {
      setError('Section is required')
      return
    }
    setError(null)
    setLoading(true)
    const result = await addClass({ ...form, nextClassId: form.nextClassId || null })
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
          <h3 className="text-base font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">Add class</h3>
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
              placeholder="e.g. Grade 1"
              className="m-input"
              autoFocus
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="m-label !mb-0">Section <span className="text-[var(--color-signal-text)]">*</span></span>
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
              <p className="text-sm text-[var(--color-neutral-500)] italic py-2">No sections yet. Add one below.</p>
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
            <p className="text-xs text-[var(--color-neutral-700)] mt-1">Lower numbers appear first in lists</p>
          </label>

          <label className="block">
            <span className="m-label">Promotes to</span>
            <select
              value={form.nextClassId}
              onChange={(e) => setForm({...form, nextClassId: e.target.value})}
              className="m-select"
            >
              <option value="">— Exits school (graduates) —</option>
              {allClasses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-xs text-[var(--color-neutral-700)] mt-1">Where students in this class move to at year-end rollover. Leave as &quot;Exits school&quot; if this is a graduating class.</p>
          </label>

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
            disabled={loading || sections.length === 0}
            className="m-btn m-btn-primary"
          >
            {loading ? 'Adding...' : 'Add class'}
          </button>
        </div>
      </div>

      {showManageSections && (
        <ManageSectionsModal
          sections={sections}
          onClose={() => setShowManageSections(false)}
          onSectionDeleted={handleSectionDeleted}
          onSectionRenamed={handleSectionRenamed}
        />
      )}
    </>
  )
}
