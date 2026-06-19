'use client'

import { useState, useEffect, useMemo } from 'react'
import { editFeeGroup, getFeeGroupDetails } from '@/app/(app)/fees/structure/actions'
import ConfirmDialog from './ConfirmDialog'

interface ClassRow { id: string, name: string, displayOrder: number }

interface ExistingItem {
  id: string
  classId: string | null
  className: string
  classDisplayOrder: number
  amount: number
  optInCount: number
}

interface Props {
  currentName: string
  isSchoolWide: boolean
  isOptional: boolean
  classes: ClassRow[]
  onClose: () => void
  onSaved: () => void
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

export default function EditFeeGroupPanel({ 
  currentName, isSchoolWide, isOptional, classes, onClose, onSaved 
}: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState<ExistingItem[]>([])

  // Form state
  const [name, setName] = useState(currentName)
  const [pricingMode, setPricingMode] = useState<'uniform' | 'per-class'>('uniform')
  const [uniformAmount, setUniformAmount] = useState<string>('')
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set())
  const [perClassAmounts, setPerClassAmounts] = useState<Record<string, string>>({})

  // Confirmation
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    onConfirm: () => Promise<void>
  } | null>(null)

  // Load existing data
  useEffect(() => {
    async function load() {
      const result = await getFeeGroupDetails(currentName, isSchoolWide, isOptional)
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
      const items = result.items as ExistingItem[]
      setExisting(items)

      if (isSchoolWide) {
        // Single row for school-wide
        if (items.length > 0) {
          setUniformAmount(String(items[0].amount))
        }
      } else {
        // Per-class: detect if amounts are uniform
        const amounts = items.map(i => i.amount)
        const allSame = amounts.every(a => a === amounts[0])
        const initialClassIds = new Set(items.map(i => i.classId).filter(Boolean) as string[])
        setSelectedClassIds(initialClassIds)

        if (allSame && items.length > 0) {
          setPricingMode('uniform')
          setUniformAmount(String(items[0].amount))
          // Also seed per-class with same amount in case they switch
          const perClass: Record<string, string> = {}
          items.forEach(i => { if (i.classId) perClass[i.classId] = String(i.amount) })
          setPerClassAmounts(perClass)
        } else {
          setPricingMode('per-class')
          const perClass: Record<string, string> = {}
          items.forEach(i => { if (i.classId) perClass[i.classId] = String(i.amount) })
          setPerClassAmounts(perClass)
        }
      }
      setLoading(false)
    }
    load()
  }, [currentName, isSchoolWide, isOptional])

  // Class display name lookup
  const classNameById = useMemo(() => {
    const map: Record<string, string> = {}
    classes.forEach(c => { map[c.id] = c.name })
    return map
  }, [classes])

  // Opt-in count per class (for warning when removing)
  const optInsByClass = useMemo(() => {
    const map: Record<string, number> = {}
    existing.forEach(i => {
      if (i.classId) map[i.classId] = i.optInCount
    })
    return map
  }, [existing])

  // Sort classes by display order for stable UI
  const sortedClasses = useMemo(() => {
    return [...classes].sort((a, b) => a.displayOrder - b.displayOrder)
  }, [classes])

  function toggleClass(classId: string) {
    const next = new Set(selectedClassIds)
    if (next.has(classId)) {
      next.delete(classId)
    } else {
      next.add(classId)
      // Seed amount if missing — use uniform amount as default
      if (!perClassAmounts[classId] && uniformAmount) {
        setPerClassAmounts({ ...perClassAmounts, [classId]: uniformAmount })
      }
    }
    setSelectedClassIds(next)
  }

  function setPerClassAmount(classId: string, value: string) {
    setPerClassAmounts({ ...perClassAmounts, [classId]: value })
  }

  // Compute summary of changes
  const summary = useMemo(() => {
    if (isSchoolWide) {
      const oldAmount = existing[0]?.amount
      const newAmt = parseInt(uniformAmount)
      const renamed = name.trim() !== currentName
      const amountChanged = !isNaN(newAmt) && newAmt !== oldAmount
      return { renamed, amountChanged, classesAdded: 0, classesRemoved: 0, classesWithOptIns: 0 }
    }

    const existingClassIds = new Set(existing.map(i => i.classId).filter(Boolean) as string[])
    const classesAdded = Array.from(selectedClassIds).filter(c => !existingClassIds.has(c)).length
    const classesRemoved = Array.from(existingClassIds).filter(c => !selectedClassIds.has(c)).length

    // Count opt-ins that would be removed (only matters for optional)
    let classesWithOptIns = 0
    if (isOptional) {
      Array.from(existingClassIds).forEach(c => {
        if (!selectedClassIds.has(c) && (optInsByClass[c] || 0) > 0) {
          classesWithOptIns += optInsByClass[c]
        }
      })
    }

    const renamed = name.trim() !== currentName
    return { renamed, amountChanged: false, classesAdded, classesRemoved, classesWithOptIns }
  }, [name, currentName, uniformAmount, selectedClassIds, existing, isSchoolWide, isOptional, optInsByClass])

  function validate(): string | null {
    if (!name.trim()) return 'Name is required'
    
    if (isSchoolWide) {
      const amt = parseInt(uniformAmount)
      if (isNaN(amt) || amt <= 0) return 'Amount must be greater than 0'
      return null
    }

    if (selectedClassIds.size === 0) {
      return 'At least one class must be selected. To remove this fee entirely, use Delete all instead.'
    }

    if (pricingMode === 'uniform') {
      const amt = parseInt(uniformAmount)
      if (isNaN(amt) || amt <= 0) return 'Amount must be greater than 0'
    } else {
      // per-class: every selected class needs a valid amount
      for (const classId of Array.from(selectedClassIds)) {
        const raw = perClassAmounts[classId]
        const amt = parseInt(raw || '')
        if (isNaN(amt) || amt <= 0) {
          return `Amount for ${classNameById[classId] || 'this class'} must be greater than 0`
        }
      }
    }

    return null
  }

  async function doSave() {
    setSaving(true)
    setError(null)

    let result
    if (isSchoolWide) {
      result = await editFeeGroup({
        currentName,
        newName: name.trim(),
        isSchoolWide: true,
        isOptional,
        uniformAmount: parseInt(uniformAmount),
        selectedClassIds: [],
      })
    } else {
      const perClass: Record<string, number> = {}
      if (pricingMode === 'per-class') {
        Array.from(selectedClassIds).forEach(cid => {
          const raw = perClassAmounts[cid]
          const amt = parseInt(raw || '')
          if (!isNaN(amt) && amt > 0) perClass[cid] = amt
        })
      }

      result = await editFeeGroup({
        currentName,
        newName: name.trim(),
        isSchoolWide: false,
        isOptional,
        uniformAmount: pricingMode === 'uniform' ? parseInt(uniformAmount) : undefined,
        perClassAmounts: pricingMode === 'per-class' ? perClass : undefined,
        selectedClassIds: Array.from(selectedClassIds),
      })
    }

    if (result.error) {
      setError(result.error)
      setSaving(false)
      setConfirmDialog(null)
      return
    }
    onSaved()
  }

  function handleSave() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)

    // If removing classes with opt-ins, confirm
    if (summary.classesWithOptIns > 0) {
      setConfirmDialog({
        title: 'Remove classes with opt-ins?',
        message: `${summary.classesWithOptIns} ${summary.classesWithOptIns === 1 ? 'student opt-in' : 'student opt-ins'} will be removed. This cannot be undone.`,
        onConfirm: doSave,
      })
      return
    }

    doSave()
  }

  // Detect if anything has actually changed (disable Save if nothing changed)
  const hasChanges = useMemo(() => {
    if (name.trim() !== currentName) return true
    if (isSchoolWide) {
      const newAmt = parseInt(uniformAmount)
      return !isNaN(newAmt) && newAmt !== existing[0]?.amount
    }
    if (summary.classesAdded > 0 || summary.classesRemoved > 0) return true
    // Check if any amounts changed
    if (pricingMode === 'uniform') {
      const newAmt = parseInt(uniformAmount)
      const oldAmounts = existing.map(i => i.amount)
      return !oldAmounts.every(a => a === newAmt)
    }
    // per-class: check each
    for (const item of existing) {
      if (item.classId && selectedClassIds.has(item.classId)) {
        const raw = perClassAmounts[item.classId]
        const newAmt = parseInt(raw || '')
        if (!isNaN(newAmt) && newAmt !== item.amount) return true
      }
    }
    return false
  }, [name, currentName, uniformAmount, pricingMode, selectedClassIds, perClassAmounts, existing, isSchoolWide, summary])

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-fit sticky top-6 max-h-[calc(100vh-3rem)]">

        <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-navy">Edit fee item</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {isOptional ? 'Optional' : 'Required'} <span className="text-gray-400 font-bold">·</span> {isSchoolWide ? 'School-wide' : 'Per-class'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <p className="text-gray-500 text-sm">Loading...</p>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-4 overflow-y-auto">

              <div>
                <label className="block text-xs text-gray-500 mb-1">Item name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                />
              </div>

              {isSchoolWide ? (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount (₦) *</label>
                  <input
                    type="number"
                    value={uniformAmount}
                    onChange={(e) => setUniformAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                  />
                  <p className="text-xs text-gray-500 mt-1">Applies to all {classes.length} active classes</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Pricing</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPricingMode('uniform')}
                        className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                          pricingMode === 'uniform'
                            ? 'bg-mint-light text-navy border-mint'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        Same amount
                      </button>
                      <button
                        type="button"
                        onClick={() => setPricingMode('per-class')}
                        className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                          pricingMode === 'per-class'
                            ? 'bg-mint-light text-navy border-mint'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        Per-class amount
                      </button>
                    </div>
                  </div>

                  {pricingMode === 'uniform' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Amount (₦) *</label>
                      <input
                        type="number"
                        value={uniformAmount}
                        onChange={(e) => setUniformAmount(e.target.value)}
                        placeholder="e.g. 100000"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
                      />
                      <p className="text-xs text-gray-500 mt-1">Applied to all selected classes below</p>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs text-gray-500">
                        Applied to ({selectedClassIds.size} of {sortedClasses.length})
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedClassIds(new Set(sortedClasses.map(c => c.id)))}
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

                    <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-50">
                      {sortedClasses.map(cls => {
                        const isSelected = selectedClassIds.has(cls.id)
                        const optIns = optInsByClass[cls.id] || 0
                        return (
                          <div
                            key={cls.id}
                            className={`flex items-center gap-2 px-3 py-2 ${isSelected ? '' : 'opacity-50'}`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleClass(cls.id)}
                              className="text-mint flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-navy truncate">{cls.name}</p>
                              {optIns > 0 && (
                                <p className="text-xs text-amber-600">{optIns} opted in</p>
                              )}
                            </div>
                            {isSelected && pricingMode === 'per-class' && (
                              <input
                                type="number"
                                value={perClassAmounts[cls.id] || ''}
                                onChange={(e) => setPerClassAmount(cls.id, e.target.value)}
                                placeholder="0"
                                className="w-24 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-mint/40"
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Summary preview */}
              {(summary.classesAdded > 0 || summary.classesRemoved > 0 || summary.renamed) && (
                <div className="p-3 bg-mint-light/40 border border-mint/20 rounded-lg space-y-1">
                  <p className="text-xs font-medium text-navy">Changes to apply:</p>
                  {summary.renamed && (
                    <p className="text-xs text-gray-700">• Rename to &quot;{name.trim()}&quot;</p>
                  )}
                  {summary.classesAdded > 0 && (
                    <p className="text-xs text-gray-700">• Add to {summary.classesAdded} new {summary.classesAdded === 1 ? 'class' : 'classes'}</p>
                  )}
                  {summary.classesRemoved > 0 && (
                    <p className="text-xs text-gray-700">
                      • Remove from {summary.classesRemoved} {summary.classesRemoved === 1 ? 'class' : 'classes'}
                      {summary.classesWithOptIns > 0 && (
                        <span className="text-amber-700"> ({summary.classesWithOptIns} opt-ins affected)</span>
                      )}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2 flex-shrink-0">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          destructive
          confirmLabel="Yes, save"
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </>
  )
}