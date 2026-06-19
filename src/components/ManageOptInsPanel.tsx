'use client'

import { useState, useEffect, useMemo } from 'react'
import { 
  getOptInsForFeeItem, 
  bulkUpdateOptIns,
  getOptInsForFeeGroup,
  bulkUpdateOptInsForGroup,
} from '@/app/(app)/fees/structure/actions'

interface Student {
  id: string
  firstName: string
  lastName: string
  admissionNumber: string
  classId: string
  className: string
}

interface FeeItem {
  id: string
  classId: string | null
  amount: number
}

interface Props {
  // Either single mode (feeItemId + feeItemAmount) or group mode (groupItems)
  feeItemId?: string
  groupItems?: FeeItem[]
  feeItemIds?: string[]
  feeItemName: string
  feeItemAmount: number  // For single mode, OR fallback for school-wide groups
  scopedToClassId?: string
  scopedClassName?: string
  onClose: () => void
  onSaved: () => void
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

export default function ManageOptInsPanel({
  feeItemId, groupItems, feeItemIds, feeItemName, feeItemAmount, scopedToClassId, scopedClassName, onClose, onSaved
}: Props) {
  const isGroup = !!feeItemIds && feeItemIds.length > 0 && !feeItemId

  const [students, setStudents] = useState<Student[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (isGroup && feeItemIds) {
        const result = await getOptInsForFeeGroup(feeItemIds)
        if (result.error) {
          setError(result.error)
          setLoading(false)
          return
        }
        setStudents(result.students)
        setSelectedIds(new Set(result.optedInStudentIds))
      } else if (feeItemId) {
        const result = await getOptInsForFeeItem(feeItemId)
        if (result.error) {
          setError(result.error)
          setLoading(false)
          return
        }
        setStudents(result.students)
        setSelectedIds(new Set(result.optedInStudentIds))
      }
      setLoading(false)
    }
    load()
  }, [feeItemId, isGroup, feeItemIds])

  // Build per-class amount lookup from groupItems
  // - If a class-specific fee_item exists, use its amount
  // - If a school-wide fee_item exists, use it as fallback for everyone
  const amountForStudent = useMemo(() => {
    const classAmountMap: Record<string, number> = {}
    let schoolWideAmount: number | null = null

    if (groupItems && groupItems.length > 0) {
      groupItems.forEach(item => {
        if (item.classId === null) {
          schoolWideAmount = item.amount
        } else {
          classAmountMap[item.classId] = item.amount
        }
      })
    }

    return (student: Student): number => {
      // Single-fee-item mode → use feeItemAmount
      if (!isGroup) return feeItemAmount

      // Group mode → look up by class
      if (student.classId && classAmountMap[student.classId] !== undefined) {
        return classAmountMap[student.classId]
      }
      if (schoolWideAmount !== null) return schoolWideAmount
      // Fallback
      return feeItemAmount
    }
  }, [groupItems, isGroup, feeItemAmount])

  // For class filter dropdown
  const classes = useMemo(() => {
    const map = new Map<string, string>()
    students.forEach(s => {
      if (s.classId) map.set(s.classId, s.className)
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [students])

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      if (scopedToClassId && s.classId !== scopedToClassId) return false

      const matchesSearch = searchTerm === '' ||
        `${s.firstName} ${s.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.admissionNumber.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesClass = classFilter === 'all' || s.classId === classFilter
      return matchesSearch && matchesClass
    })
  }, [students, searchTerm, classFilter, scopedToClassId])

  const eligibleStudents = useMemo(() => {
    if (scopedToClassId) {
      return students.filter(s => s.classId === scopedToClassId)
    }
    return students
  }, [students, scopedToClassId])

  const eligibleSelectedCount = useMemo(() => {
    return eligibleStudents.filter(s => selectedIds.has(s.id)).length
  }, [eligibleStudents, selectedIds])

  // Total amount = sum of (each selected eligible student × their class's amount)
  const totalAmount = useMemo(() => {
    const studentsToSum = scopedToClassId
      ? eligibleStudents.filter(s => selectedIds.has(s.id))
      : students.filter(s => selectedIds.has(s.id))
    return studentsToSum.reduce((sum, s) => sum + amountForStudent(s), 0)
  }, [students, eligibleStudents, selectedIds, scopedToClassId, amountForStudent])

  function toggleStudent(studentId: string) {
    const next = new Set(selectedIds)
    if (next.has(studentId)) {
      next.delete(studentId)
    } else {
      next.add(studentId)
    }
    setSelectedIds(next)
  }

  function selectAllFiltered() {
    const next = new Set(selectedIds)
    filteredStudents.forEach(s => next.add(s.id))
    setSelectedIds(next)
  }

  function clearAllFiltered() {
    const next = new Set(selectedIds)
    filteredStudents.forEach(s => next.delete(s.id))
    setSelectedIds(next)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    let idsToSave: string[]
    if (scopedToClassId) {
      const scopedStudentIds = new Set(eligibleStudents.map(s => s.id))
      const outsideScope = Array.from(selectedIds).filter(id => !scopedStudentIds.has(id))
      const inScope = Array.from(selectedIds).filter(id => scopedStudentIds.has(id))
      idsToSave = [...outsideScope, ...inScope]
    } else {
      idsToSave = Array.from(selectedIds)
    }

    let result
    if (isGroup && feeItemIds) {
      result = await bulkUpdateOptInsForGroup(feeItemIds, idsToSave)
    } else if (feeItemId) {
      result = await bulkUpdateOptIns(feeItemId, idsToSave)
    } else {
      setError('No fee item context')
      setSaving(false)
      return
    }

    if (result.error) {
      setError(result.error)
      setSaving(false)
      return
    }
    onSaved()
  }

  // Show "Varies" indicator if amounts differ across selected students
  const hasVaryingAmounts = useMemo(() => {
    if (!isGroup || !groupItems || groupItems.length === 0) return false
    const amounts = groupItems.map(i => i.amount)
    return !amounts.every(a => a === amounts[0])
  }, [isGroup, groupItems])

  return (
    <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-fit sticky top-6 max-h-[calc(100vh-3rem)]">

      <div className="p-5 border-b border-gray-100 flex items-start justify-between flex-shrink-0">
        <div>
          <h3 className="text-base font-semibold text-navy">Manage opt-ins</h3>
          <p className="text-xs text-gray-500 mt-1">
            {feeItemName}
            {hasVaryingAmounts ? (
              <> <span className="text-gray-400 font-bold">·</span> <span className="italic">Varies by class</span></>
            ) : (
              <> <span className="text-gray-400 font-bold">·</span> {formatNaira(feeItemAmount)}</>
            )}
            {scopedClassName && (
              <> <span className="text-gray-400 font-bold">·</span> {scopedClassName} only</>
            )}
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
          <p className="text-gray-500 text-sm">Loading students...</p>
        </div>
      ) : (
        <>
          <div className="px-5 py-2.5 bg-mint-light/50 border-b border-mint/20 flex items-center justify-between flex-shrink-0">
            <div>
              <span className="text-sm font-medium text-navy">
                {scopedToClassId ? eligibleSelectedCount : selectedIds.size} opted in
              </span>
              <span className="text-xs text-gray-600 ml-2">
                of {eligibleStudents.length}
              </span>
            </div>
            <span className="text-sm font-semibold text-navy">
              {formatNaira(totalAmount)}
            </span>
          </div>

          <div className="p-3 border-b border-gray-100 flex flex-col gap-2 flex-shrink-0">
            <input
              type="text"
              placeholder="Search students..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
            />
            {!scopedToClassId && classes.length > 1 && (
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
              >
                <option value="all">All classes</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 flex-shrink-0">
            <button
              onClick={selectAllFiltered}
              className="text-xs text-mint font-medium hover:underline"
            >
              Select all
            </button>
            <span className="text-gray-300">·</span>
            <button
              onClick={clearAllFiltered}
              className="text-xs text-gray-600 font-medium hover:underline"
            >
              Clear
            </button>
            <span className="text-xs text-gray-400 ml-auto">
              {filteredStudents.length}/{eligibleStudents.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {filteredStudents.length === 0 ? (
              <p className="p-6 text-center text-gray-500 text-sm">No students match.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {filteredStudents.map(student => {
                  const studentAmount = amountForStudent(student)
                  return (
                    <label
                      key={student.id}
                      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(student.id)}
                        onChange={() => toggleStudent(student.id)}
                        className="text-mint flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-navy truncate">
                          {student.firstName} {student.lastName}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {student.className} <span className="text-gray-300 font-bold">·</span> {student.admissionNumber}
                          {hasVaryingAmounts && (
                            <> <span className="text-gray-300 font-bold">·</span> {formatNaira(studentAmount)}</>
                          )}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="px-4 py-2 bg-red-50 border-t border-red-200 flex-shrink-0">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

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
              disabled={saving}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}