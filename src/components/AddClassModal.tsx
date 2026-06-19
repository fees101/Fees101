'use client'

import { useState } from 'react'
import { addClass, addSection, deleteSection } from '@/app/(app)/fees/classes/actions'

interface Section {
  id: string
  name: string
}

interface Props {
  sections: Section[]
  existingDisplayOrders: number[]
  onClose: () => void
  onSuccess: () => void
}

export default function AddClassModal({ sections: initialSections, existingDisplayOrders, onClose, onSuccess }: Props) {
  const maxOrder = existingDisplayOrders.length > 0 ? Math.max(...existingDisplayOrders) : 0

  const [sections, setSections] = useState<Section[]>(initialSections)
  const [form, setForm] = useState({
    name: '',
    sectionId: initialSections[0]?.id || '',
    displayOrder: maxOrder + 1,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Inline add section state
  const [showAddSection, setShowAddSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')
  const [addingSectionLoading, setAddingSectionLoading] = useState(false)
  const [sectionError, setSectionError] = useState<string | null>(null)

  // Manage sections modal
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
    if (!form.sectionId) {
      setError('Section is required')
      return
    }
    setError(null)
    setLoading(true)
    const result = await addClass(form)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-navy">Add class</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Class name *</label>
            <input 
              type="text" 
              value={form.name} 
              onChange={(e) => setForm({...form, name: e.target.value})}
              placeholder="e.g. Grade 1"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
              autoFocus
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-gray-500">Section *</label>
              {sections.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowManageSections(true)}
                  className="text-xs text-gray-500 hover:text-navy hover:underline"
                >
                  Manage sections
                </button>
              )}
            </div>
            {sections.length > 0 ? (
              <select 
                value={form.sectionId} 
                onChange={(e) => setForm({...form, sectionId: e.target.value})}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
              >
                {sections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-gray-400 italic py-2">No sections yet. Add one below.</p>
            )}

            {/* Inline add section */}
            {showAddSection ? (
              <div className="mt-2 p-3 bg-mint-light/30 rounded-lg border border-mint/20">
                <label className="block text-xs text-gray-500 mb-1">New section name</label>
                <input
                  type="text"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  placeholder="e.g. Primary, Secondary, Nursery"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                  autoFocus
                />
                {sectionError && (
                  <p className="text-xs text-red-600 mt-1">{sectionError}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={handleAddSection}
                    disabled={addingSectionLoading || !newSectionName.trim()}
                    className="px-3 py-1 bg-mint text-navy text-xs font-semibold rounded hover:bg-mint/90 disabled:opacity-50"
                  >
                    {addingSectionLoading ? 'Adding...' : 'Add section'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddSection(false); setNewSectionName(''); setSectionError(null) }}
                    className="px-3 py-1 text-gray-600 text-xs font-medium hover:bg-gray-100 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddSection(true)}
                className="mt-2 text-xs text-mint font-medium hover:underline"
              >
                + Add new section
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Display order</label>
            <input 
              type="number" 
              value={form.displayOrder} 
              onChange={(e) => setForm({...form, displayOrder: parseInt(e.target.value) || 0})}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            />
            <p className="text-xs text-gray-500 mt-1">Lower numbers appear first in lists</p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={loading || sections.length === 0} 
            className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add class'}
          </button>
        </div>
      </div>

      {/* Manage sections modal */}
      {showManageSections && (
        <ManageSectionsModal
          sections={sections}
          onClose={() => setShowManageSections(false)}
          onSectionDeleted={handleSectionDeleted}
        />
      )}
    </div>
  )
}

function ManageSectionsModal({ sections, onClose, onSectionDeleted }: {
  sections: Section[]
  onClose: () => void
  onSectionDeleted: (id: string) => void
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
                <div key={section.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                  <span className="text-sm text-navy">{section.name}</span>
                  <button
                    onClick={() => handleDelete(section.id)}
                    disabled={deletingId === section.id}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    {deletingId === section.id ? 'Deleting...' : 'Delete'}
                  </button>
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