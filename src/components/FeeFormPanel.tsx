'use client'

import { useState } from 'react'
import { addFeeItem, updateFeeItem } from '@/app/(app)/fees/structure/actions'

interface ClassRow { id: string, name: string, displayOrder: number }

interface FeeItem {
  id: string
  classId: string | null
  name: string
  amount: number
  isRequired: boolean
  isOptional: boolean
  isSchoolWide: boolean
}

interface Props {
  mode: 'add' | 'edit'
  classes: ClassRow[]
  currentClassId?: string
  editItem?: FeeItem
  onClose: () => void
  onSuccess: () => void
}

export default function FeeFormPanel({ mode, classes, currentClassId, editItem, onClose, onSuccess }: Props) {
  const isEdit = mode === 'edit'

  const [name, setName] = useState(editItem?.name || '')
  const [amount, setAmount] = useState(editItem ? String(editItem.amount) : '')
  const [isRequired, setIsRequired] = useState(editItem ? editItem.isRequired : true)
  const [scope, setScope] = useState<'one' | 'multiple' | 'all-school'>(
    editItem
      ? (editItem.isSchoolWide ? 'all-school' : 'one')
      : 'one'
  )
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(
    new Set(currentClassId ? [currentClassId] : [])
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentClass = classes.find(c => c.id === currentClassId)

  function toggleClass(classId: string) {
    const next = new Set(selectedClassIds)
    if (next.has(classId)) {
      next.delete(classId)
    } else {
      next.add(classId)
    }
    setSelectedClassIds(next)
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError('Item name is required')
      return
    }
    const amt = parseInt(amount)
    if (isNaN(amt) || amt <= 0) {
      setError('Amount must be greater than 0')
      return
    }

    setError(null)
    setLoading(true)

    let result
    if (isEdit) {
      result = await updateFeeItem(editItem!.id, { name, amount: amt })
    } else {
      result = await addFeeItem({
        name,
        amount: amt,
        isRequired,
        scope,
        classIds: scope === 'all-school' ? [] : Array.from(selectedClassIds),
      })
    }

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    onSuccess()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-fit sticky top-6">

      {/* Header */}
      <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <h3 className="text-base font-semibold text-navy">
          {isEdit ? 'Edit fee item' : 'Add fee item'}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">

        {!isEdit && (
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Type *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsRequired(true)}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  isRequired
                    ? 'bg-mint-light text-navy border-mint'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                Required
              </button>
              <button
                type="button"
                onClick={() => setIsRequired(false)}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  !isRequired
                    ? 'bg-amber-50 text-amber-900 border-amber-400'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                Optional
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              {isRequired
                ? 'Charged automatically to every student in scope'
                : 'Students opt in individually'}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">Item name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isRequired ? 'e.g. Tuition, Books, PTA Levy' : 'e.g. Bus fee, Lunch, Chess club'}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Amount (₦) *</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 100000"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
          />
        </div>

        {!isEdit && (
          <div>
            <label className="block text-xs text-gray-500 mb-2">Apply to *</label>
            <div className="space-y-1.5">
              {currentClass && (
                <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    checked={scope === 'one'}
                    onChange={() => setScope('one')}
                    className="mt-0.5 text-mint"
                  />
                  <div>
                    <span className="text-sm text-navy">Just this class ({currentClass.name})</span>
                  </div>
                </label>
              )}
              <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  checked={scope === 'multiple'}
                  onChange={() => setScope('multiple')}
                  className="mt-0.5 text-mint"
                />
                <div>
                  <span className="text-sm text-navy">Multiple classes</span>
                  <p className="text-xs text-gray-500">Choose specific classes below</p>
                </div>
              </label>
              <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  checked={scope === 'all-school'}
                  onChange={() => setScope('all-school')}
                  className="mt-0.5 text-mint"
                />
                <div>
                  <span className="text-sm text-navy">All students (school-wide)</span>
                  <p className="text-xs text-gray-500">One fee that applies to everyone</p>
                </div>
              </label>
            </div>
          </div>
        )}

        {!isEdit && scope === 'multiple' && (
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">
                {selectedClassIds.size} selected
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedClassIds(new Set(classes.map(c => c.id)))}
                  className="text-xs text-mint font-medium hover:underline"
                >
                  All
                </button>
                <span className="text-gray-300">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedClassIds(new Set())}
                  className="text-xs text-gray-600 font-medium hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {classes.map(cls => (
                <label key={cls.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedClassIds.has(cls.id)}
                    onChange={() => toggleClass(cls.id)}
                    className="text-mint"
                  />
                  <span className="text-sm text-navy">{cls.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {!isEdit && !isRequired && (
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <p className="text-xs text-amber-900">
              After creating, click <strong>Manage opt-ins</strong> to enroll students.
            </p>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-5 border-t border-gray-100 flex items-center justify-end gap-2 flex-shrink-0">
        <button
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
        >
          {loading ? 'Saving...' : isEdit ? 'Save' : 'Add fee item'}
        </button>
      </div>
    </div>
  )
}