'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  getOptInsSummaryForFeeItem,
  getOptInsPageForFeeItem,
  getEligibleIdsForFeeItem,
  getEligibleClassesForFeeItem,
  getOptInsSummaryForFeeGroup,
  getOptInsPageForFeeGroup,
  getEligibleIdsForFeeGroup,
  getEligibleClassesForFeeGroup,
  bulkUpdateOptIns,
  bulkUpdateOptInsForGroup,
  type OptInStudentRow,
  type OptInClassOption,
} from '@/app/(app)/fees/structure/actions'

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

const PER_PAGE = 30

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

export default function ManageOptInsPanel({
  feeItemId, groupItems, feeItemIds, feeItemName, feeItemAmount, scopedToClassId, scopedClassName, onClose, onSaved
}: Props) {
  const isGroup = !!feeItemIds && feeItemIds.length > 0 && !feeItemId

  // Selection state — persists across page/search/filter changes. Sourced
  // once from the summary fetch, then only ever added to/removed from
  // locally (toggle, select-all-matching-filter, clear-matching-filter), so
  // navigating pages never clobbers an unsaved in-progress change.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // classId per student we've ever seen (opted-in, on a loaded page, or from
  // a select-all/clear fetch) — needed to compute the running total for a
  // selected student who isn't on the currently-loaded page. Eligible
  // classId only; an opted-in student outside eligibility scope is tracked
  // in selectedIds (Save still preserves that row) but absent here, so it's
  // correctly excluded from eligibleSelectedCount/totalAmount.
  const [classById, setClassById] = useState<Record<string, string>>({})
  const [eligibleTotal, setEligibleTotal] = useState(0)
  // When scopedToClassId narrows the whole panel to one class, "of N" needs
  // that class's eligible count, not the fee item/group's whole pool — fetched
  // once up front so it stays stable regardless of what's typed into search.
  const [scopedEligibleTotal, setScopedEligibleTotal] = useState(0)

  const [classOptions, setClassOptions] = useState<OptInClassOption[]>([])
  const [pageStudents, setPageStudents] = useState<OptInStudentRow[]>([])
  const [filteredTotal, setFilteredTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('all')

  const [loading, setLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [bulkBusy, setBulkBusy] = useState<'select' | 'clear' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounce the search box so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Initial load: everything about who's already opted in, plus the class
  // filter's options. Only re-runs if the underlying fee item(s) change.
  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError(null)
      const [summary, classesResult] = await Promise.all([
        isGroup && feeItemIds ? getOptInsSummaryForFeeGroup(feeItemIds) : feeItemId ? getOptInsSummaryForFeeItem(feeItemId) : null,
        isGroup && feeItemIds ? getEligibleClassesForFeeGroup(feeItemIds) : feeItemId ? getEligibleClassesForFeeItem(feeItemId) : null,
      ])
      if (ignore) return
      if (!summary || summary.error) {
        setError(summary?.error || 'No fee item context')
        setLoading(false)
        return
      }
      setSelectedIds(new Set(summary.optedInStudentIds))
      const nextClassById: Record<string, string> = {}
      for (const [id, classId] of Object.entries(summary.optedInClassMap)) {
        if (classId) nextClassById[id] = classId
      }
      setClassById(nextClassById)
      setEligibleTotal(summary.eligibleTotal)
      if (classesResult && !classesResult.error) setClassOptions(classesResult.classes)

      if (scopedToClassId) {
        const scopedIds = isGroup && feeItemIds
          ? await getEligibleIdsForFeeGroup(feeItemIds, { search: '', classId: scopedToClassId })
          : feeItemId ? await getEligibleIdsForFeeItem(feeItemId, { search: '', classId: scopedToClassId }) : null
        if (!ignore && scopedIds && !scopedIds.error) setScopedEligibleTotal(scopedIds.ids.length)
      }

      setLoading(false)
    }
    load()
    return () => { ignore = true }
  }, [feeItemId, isGroup, feeItemIds, scopedToClassId])

  // Page fetch — whenever page/search/class filter changes. Independent of
  // the selection state above; only supplies rows to render.
  useEffect(() => {
    if (loading) return
    let ignore = false
    async function loadPage() {
      setPageLoading(true)
      const params = { page, perPage: PER_PAGE, search, classId: scopedToClassId || (classFilter === 'all' ? null : classFilter) }
      const result = isGroup && feeItemIds
        ? await getOptInsPageForFeeGroup(feeItemIds, params)
        : feeItemId ? await getOptInsPageForFeeItem(feeItemId, params) : null
      if (ignore) return
      if (!result || result.error) {
        setError(result?.error || 'No fee item context')
        setPageLoading(false)
        return
      }
      setPageStudents(result.students)
      setFilteredTotal(result.total)
      setClassById(prev => {
        const next = { ...prev }
        for (const s of result.students) next[s.id] = s.classId
        return next
      })
      setPageLoading(false)
    }
    loadPage()
    return () => { ignore = true }
  }, [feeItemId, isGroup, feeItemIds, page, search, classFilter, scopedToClassId, loading])

  const amountForStudent = useMemo(() => {
    const classAmountMap: Record<string, number> = {}
    let schoolWideAmount: number | null = null
    if (groupItems && groupItems.length > 0) {
      groupItems.forEach(item => {
        if (item.classId === null) schoolWideAmount = item.amount
        else classAmountMap[item.classId] = item.amount
      })
    }
    return (classId: string | undefined): number => {
      if (!isGroup) return feeItemAmount
      if (classId && classAmountMap[classId] !== undefined) return classAmountMap[classId]
      if (schoolWideAmount !== null) return schoolWideAmount
      return feeItemAmount
    }
  }, [groupItems, isGroup, feeItemAmount])

  const hasVaryingAmounts = useMemo(() => {
    if (!isGroup || !groupItems || groupItems.length === 0) return false
    const amounts = groupItems.map(i => i.amount)
    return !amounts.every(a => a === amounts[0])
  }, [isGroup, groupItems])

  // Only counting/summing students whose classId we've resolved to an
  // eligible one (see classById's comment), and — when scopedToClassId
  // narrows the panel to one class within a broader group — only those in
  // that class. A selected id outside either check stays in selectedIds
  // (Save still preserves it) but doesn't inflate this count/total.
  const eligibleSelectedCount = useMemo(() => {
    let n = 0
    selectedIds.forEach(id => {
      const classId = classById[id]
      if (classId === undefined) return
      if (scopedToClassId && classId !== scopedToClassId) return
      n++
    })
    return n
  }, [selectedIds, classById, scopedToClassId])

  const totalAmount = useMemo(() => {
    let sum = 0
    selectedIds.forEach(id => {
      const classId = classById[id]
      if (classId === undefined) return
      if (scopedToClassId && classId !== scopedToClassId) return
      sum += amountForStudent(classId)
    })
    return sum
  }, [selectedIds, classById, scopedToClassId, amountForStudent])

  const totalPages = Math.max(1, Math.ceil(filteredTotal / PER_PAGE))
  const rangeStart = filteredTotal === 0 ? 0 : (page - 1) * PER_PAGE + 1
  const rangeEnd = Math.min(page * PER_PAGE, filteredTotal)

  function toggleStudent(student: OptInStudentRow) {
    setClassById(prev => (prev[student.id] ? prev : { ...prev, [student.id]: student.classId }))
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(student.id)) next.delete(student.id)
      else next.add(student.id)
      return next
    })
  }

  async function fetchMatchingIds(): Promise<{ id: string; classId: string }[] | null> {
    const params = { search, classId: scopedToClassId || (classFilter === 'all' ? null : classFilter) }
    const result = isGroup && feeItemIds
      ? await getEligibleIdsForFeeGroup(feeItemIds, params)
      : feeItemId ? await getEligibleIdsForFeeItem(feeItemId, params) : null
    if (!result || result.error) {
      setError(result?.error || 'No fee item context')
      return null
    }
    return result.ids
  }

  async function selectAllFiltered() {
    setBulkBusy('select')
    const ids = await fetchMatchingIds()
    setBulkBusy(null)
    if (!ids) return
    setClassById(prev => {
      const next = { ...prev }
      for (const row of ids) next[row.id] = row.classId
      return next
    })
    setSelectedIds(prev => {
      const next = new Set(prev)
      ids.forEach(row => next.add(row.id))
      return next
    })
  }

  async function clearAllFiltered() {
    setBulkBusy('clear')
    const ids = await fetchMatchingIds()
    setBulkBusy(null)
    if (!ids) return
    const matchSet = new Set(ids.map(row => row.id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      matchSet.forEach(id => next.delete(id))
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const idsToSave = Array.from(selectedIds)

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

  const eligibleTotalDisplay = scopedToClassId ? scopedEligibleTotal : eligibleTotal

  return (
    <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] flex flex-col h-fit lg:sticky lg:top-24 max-h-[calc(100vh-6rem)]">

      <div className="p-5 border-b-2 border-[var(--color-ink)] flex items-start justify-between flex-shrink-0">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">Manage opt-ins</h3>
          <p className="text-xs text-[var(--color-neutral-700)] mt-1 m-num">
            {feeItemName}
            {hasVaryingAmounts ? (
              <> &middot; <span className="italic">Varies by class</span></>
            ) : (
              <> &middot; {formatNaira(feeItemAmount)}</>
            )}
            {scopedClassName && (
              <> &middot; {scopedClassName} only</>
            )}
          </p>
        </div>
        <button onClick={onClose} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
          Close
        </button>
      </div>

      {loading ? (
        <div className="p-5">
          <div className="m-loading mb-3" />
          <p className="text-sm text-[var(--color-neutral-700)]">Loading students...</p>
        </div>
      ) : (
        <>
          <div className="px-5 py-2.5 bg-[var(--color-surface)] border-b-2 border-[var(--color-ink)] flex items-center justify-between flex-shrink-0">
            <div>
              <span className="text-sm font-semibold text-[var(--color-ink)] m-num">
                {eligibleSelectedCount} opted in
              </span>
              <span className="text-xs text-[var(--color-neutral-700)] ml-2 m-num">
                of {eligibleTotalDisplay}
              </span>
            </div>
            <span className="text-sm font-semibold text-[var(--color-ink)] m-num">
              {formatNaira(totalAmount)}
            </span>
          </div>

          <div className="p-3 border-b border-[var(--color-neutral-300)] flex flex-col gap-2 flex-shrink-0">
            <input
              type="text"
              placeholder="Search students..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="m-input"
            />
            {!scopedToClassId && classOptions.length > 1 && (
              <select
                value={classFilter}
                onChange={(e) => { setClassFilter(e.target.value); setPage(1) }}
                className="m-select"
              >
                <option value="all">All classes</option>
                {classOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="px-4 py-2 border-b border-[var(--color-neutral-300)] flex items-center gap-3 flex-shrink-0">
            <button onClick={selectAllFiltered} disabled={bulkBusy !== null} className="text-xs font-semibold text-[var(--color-ink)] hover:underline disabled:opacity-50">
              {bulkBusy === 'select' ? 'Selecting...' : 'Select all'}
            </button>
            <button onClick={clearAllFiltered} disabled={bulkBusy !== null} className="text-xs font-semibold text-[var(--color-neutral-700)] hover:underline disabled:opacity-50">
              {bulkBusy === 'clear' ? 'Clearing...' : 'Clear'}
            </button>
            <span className="text-xs text-[var(--color-neutral-500)] ml-auto m-num">
              {filteredTotal}{scopedToClassId ? '' : ` matching`}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {pageLoading ? (
              <div className="p-6"><div className="m-loading" /></div>
            ) : pageStudents.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--color-neutral-700)]">No students match.</p>
            ) : (
              <div className="divide-y divide-[var(--color-neutral-300)]">
                {pageStudents.map(student => {
                  const studentAmount = amountForStudent(student.classId)
                  return (
                    <label
                      key={student.id}
                      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--color-surface)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(student.id)}
                        onChange={() => toggleStudent(student)}
                        className="accent-[var(--color-ink)] flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--color-ink)] truncate">
                          {student.firstName} {student.lastName}
                        </p>
                        <p className="text-xs text-[var(--color-neutral-700)] truncate m-num">
                          {student.className} &middot; {student.admissionNumber}
                          {hasVaryingAmounts && (
                            <> &middot; {formatNaira(studentAmount)}</>
                          )}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="px-4 py-2 border-t border-[var(--color-neutral-300)] flex items-center justify-between flex-shrink-0">
              <span className="text-[12px] text-[var(--color-neutral-700)] m-num">
                {rangeStart}&ndash;{rangeEnd} of {filteredTotal}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1 || pageLoading}
                  className="text-[12px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ padding: '4px 8px' }}
                >
                  Prev
                </button>
                <span className="text-[12px] m-num px-1 text-[var(--color-ink)]">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || pageLoading}
                  className="text-[12px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ padding: '4px 8px' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 py-2 border-t-2 border-[var(--color-signal)] flex-shrink-0">
              <p className="text-sm text-[var(--color-signal-text)]">{error}</p>
            </div>
          )}

          <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2 flex-shrink-0">
            <button onClick={onClose} disabled={saving} className="m-btn m-btn-outline">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} className="m-btn m-btn-primary">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
