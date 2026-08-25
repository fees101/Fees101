'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import FeeFormPanel from './FeeFormPanel'
import ManageOptInsPanel from './ManageOptInsPanel'
import EditFeeGroupPanel from './EditFeeGroupPanel'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { deleteFeeItem, bulkDeleteFeeItemByName } from '@/app/(app)/fees/structure/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'

interface ClassRow { id: string, name: string, displayOrder: number }
interface FeeItem {
  id: string
  classId: string | null
  name: string
  amount: number
  isRequired: boolean
  isOptional: boolean
  isSchoolWide: boolean
  isDiscountable?: boolean
  optInCount: number
}
interface Cycle { id: string, name: string, status: string }

interface Data {
  cycle: Cycle | null
  classes: ClassRow[]
  allFees: FeeItem[]
  studentCountByClass: Record<string, number>
  totalActiveStudents: number
}

interface Props {
  data: Data
  initialView: 'class' | 'item'
  initialClassId?: string
  readOnly?: boolean
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

export default function FeeStructureLayout({ data, initialView, initialClassId, readOnly: readOnlyProp = false }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const canManageFeeStructure = useCan('manage-fee-structure')
  // Read-only if the caller says so (e.g. a closed term) OR the user lacks
  // manage-fee-structure — a see-fee-structure-only user can view but not edit.
  const readOnly = readOnlyProp || !canManageFeeStructure
  const { cycle, classes, allFees, studentCountByClass, totalActiveStudents } = data

  const [view, setView] = useState<'class' | 'item'>(initialView)
  const [selectedClassId, setSelectedClassId] = useState<string>(
    initialClassId || classes[0]?.id || ''
  )
  const [panelMode, setPanelMode] = useState<'add' | 'edit' | null>(null)
  const [editingItem, setEditingItem] = useState<FeeItem | null>(null)
  const [editingGroup, setEditingGroup] = useState<{
    name: string
    isSchoolWide: boolean
    isOptional: boolean
  } | null>(null)
  const [managingOptInsFor, setManagingOptInsFor] = useState<FeeItem | null>(null)
  const [optInsScopedToClass, setOptInsScopedToClass] = useState<boolean>(false)
  const [managingOptInsGroup, setManagingOptInsGroup] = useState<{
    name: string
    items: FeeItem[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    destructive?: boolean
    onConfirm: () => Promise<void>
  } | null>(null)

  const selectedClass = classes.find(c => c.id === selectedClassId)

  function revenueFor(item: FeeItem): number {
    if (item.isOptional) {
      return item.amount * item.optInCount
    }
    if (item.isSchoolWide) {
      return item.amount * totalActiveStudents
    }
    if (item.classId) {
      return item.amount * (studentCountByClass[item.classId] || 0)
    }
    return 0
  }

  const feesForSelectedClass = useMemo(() => {
    return allFees
      .filter(f => f.classId === selectedClassId || f.isSchoolWide)
      .sort((a, b) => {
        if (a.isRequired !== b.isRequired) return a.isRequired ? -1 : 1
        if (a.isSchoolWide !== b.isSchoolWide) return a.isSchoolWide ? 1 : -1
        return a.name.localeCompare(b.name)
      })
  }, [allFees, selectedClassId])

  const requiredFees = feesForSelectedClass.filter(f => f.isRequired)
  const optionalFees = feesForSelectedClass.filter(f => f.isOptional)
  const requiredTotal = requiredFees.reduce((sum, f) => sum + f.amount, 0)
  const optionalTotal = optionalFees.reduce((sum, f) => sum + f.amount, 0)

  const feesByName = useMemo(() => {
    const groups: Record<string, {
      key: string
      name: string
      items: FeeItem[]
      totalClasses: number
      isSchoolWide: boolean
      isRequired: boolean
      sameAmount: boolean
      amount: number | null
      totalRevenue: number
    }> = {}

    allFees.forEach(f => {
      const scopeKey = f.isSchoolWide ? 'school' : 'class'
      const key = `${f.name}::${scopeKey}::${f.isRequired ? 'req' : 'opt'}`

      if (!groups[key]) {
        groups[key] = {
          key,
          name: f.name,
          items: [],
          totalClasses: 0,
          isSchoolWide: f.isSchoolWide,
          isRequired: f.isRequired,
          sameAmount: true,
          amount: f.amount,
          totalRevenue: 0,
        }
      }
      groups[key].items.push(f)
      if (!f.isSchoolWide) groups[key].totalClasses++
      if (groups[key].amount !== f.amount) {
        groups[key].sameAmount = false
      }
      groups[key].totalRevenue += revenueFor(f)
    })

    return Object.values(groups).sort((a, b) => {
      if (a.isRequired !== b.isRequired) return a.isRequired ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFees, studentCountByClass, totalActiveStudents])

  const requiredGroups = feesByName.filter(g => g.isRequired)
  const optionalGroups = feesByName.filter(g => !g.isRequired)

  const requiredRevenueTotal = requiredGroups.reduce((sum, g) => sum + g.totalRevenue, 0)
  const optionalRevenueTotal = optionalGroups.reduce((sum, g) => sum + g.totalRevenue, 0)

  function handleDelete(item: FeeItem) {
    if (readOnly) return
    setError(null)
    const message = item.optInCount > 0
      ? `${item.optInCount} ${item.optInCount === 1 ? 'student has' : 'students have'} opted in. Their opt-ins will be removed too. This cannot be undone.`
      : 'This cannot be undone.'

    setConfirmDialog({
      title: `Delete "${item.name}"?`,
      message,
      destructive: true,
      onConfirm: async () => {
        const result = await deleteFeeItem(item.id)
        if (result.error) {
          setError(result.error)
        } else {
          router.refresh()
        }
        setConfirmDialog(null)
      },
    })
  }

  function handleBulkDelete(name: string) {
    if (readOnly || !cycle) return
    setError(null)
    const matches = allFees.filter(f => f.name === name)
    const count = matches.length
    const totalOptIns = matches.reduce((sum, f) => sum + f.optInCount, 0)

    let message = `This will remove "${name}" from ${count} ${count === 1 ? 'fee item' : 'fee items'}`
    if (totalOptIns > 0) {
      message += ` and remove opt-ins for ${totalOptIns} ${totalOptIns === 1 ? 'student' : 'students'}`
    }
    message += '. This cannot be undone.'

    setConfirmDialog({
      title: `Delete all "${name}" fees?`,
      message,
      destructive: true,
      onConfirm: async () => {
        const result = await bulkDeleteFeeItemByName(cycle.id, name)
        if (result.error) {
          setError(result.error)
        } else {
          router.refresh()
        }
        setConfirmDialog(null)
      },
    })
  }

  function switchView(newView: 'class' | 'item') {
    closeAllPanels()
    setView(newView)
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', newView)
    router.replace(`/fees/structure?${params.toString()}`)
  }

  function selectClass(classId: string) {
    closeAllPanels()
    setSelectedClassId(classId)
    const params = new URLSearchParams(searchParams.toString())
    params.set('class', classId)
    router.replace(`/fees/structure?${params.toString()}`)
  }

  function openAddPanel() {
    if (readOnly) return
    closeAllPanels()
    setEditingItem(null)
    setPanelMode('add')
  }

  function openEditPanel(item: FeeItem) {
    if (readOnly) return
    closeAllPanels()
    setEditingItem(item)
    setPanelMode('edit')
  }

  function openEditGroupPanel(group: { name: string, isSchoolWide: boolean, isOptional: boolean }) {
    if (readOnly) return
    closeAllPanels()
    setEditingGroup(group)
  }

  function closePanel() {
    setPanelMode(null)
    setEditingItem(null)
  }

  function closeGroupPanel() {
    setEditingGroup(null)
  }

  function openOptIns(item: FeeItem, scoped: boolean) {
    if (readOnly) return
    closeAllPanels()
    setManagingOptInsFor(item)
    setOptInsScopedToClass(scoped)
  }

  function openGroupOptIns(group: { name: string, items: FeeItem[] }) {
    if (readOnly) return
    closeAllPanels()
    setManagingOptInsGroup(group)
  }

  function closeOptIns() {
    setManagingOptInsFor(null)
    setManagingOptInsGroup(null)
    setOptInsScopedToClass(false)
  }

  function closeAllPanels() {
    closePanel()
    closeGroupPanel()
    closeOptIns()
  }

  if (!cycle) {
    return (
      <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
        <p className="text-gray-500">No active billing cycle. Create a term first.</p>
      </div>
    )
  }

  const sidePanelOpen = panelMode !== null || managingOptInsFor !== null || managingOptInsGroup !== null || editingGroup !== null

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy">Fee structure</h1>
          <p className="text-gray-500 mt-2 text-sm">
            Set fees for each class <span className="text-gray-400 font-bold">·</span> Editing: {cycle.name}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => switchView('class')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'class' ? 'bg-white text-navy shadow-sm' : 'text-gray-600 hover:text-navy'
            }`}
          >
            By class
          </button>
          <button
            onClick={() => switchView('item')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'item' ? 'bg-white text-navy shadow-sm' : 'text-gray-600 hover:text-navy'
            }`}
          >
            By fee item
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className={`grid gap-4 ${sidePanelOpen ? 'grid-cols-[1fr_380px]' : 'grid-cols-1'}`}>

        <div>

          {view === 'class' && (
            <div className="grid grid-cols-[160px_1fr] md:grid-cols-[200px_1fr] gap-4 mb-6">

              <div className="bg-white rounded-xl border border-gray-200 p-2 h-fit">
                <p className="text-xs text-gray-500 uppercase tracking-wider px-2 py-2">Classes</p>
                {classes.map(cls => (
                  <button
                    key={cls.id}
                    onClick={() => selectClass(cls.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedClassId === cls.id
                        ? 'bg-mint-light text-navy font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-navy'
                    }`}
                  >
                    {cls.name}
                  </button>
                ))}
              </div>

              <div className="space-y-4">

                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-navy font-semibold text-lg">
                      {selectedClass?.name || 'Select a class'} — required fees
                    </h2>
                    {selectedClass && !readOnly && (
                      <button
                        onClick={openAddPanel}
                        className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
                      >
                        + Add fee item
                      </button>
                    )}
                  </div>

                  {requiredFees.length === 0 ? (
                    <p className="text-gray-500 text-sm py-6 text-center">No required fees yet.</p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Item name</th>
                          <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Amount</th>
                          {!readOnly && <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {requiredFees.map(item => (
                          <tr key={item.id}>
                            <td className="py-3">
                              <span className="text-sm text-navy">{item.name}</span>
                              {item.isSchoolWide && (
                                <span className="ml-2 text-xs text-gray-500">(school-wide)</span>
                              )}
                            </td>
                            <td className="py-3 text-sm text-right text-navy font-medium">{formatNaira(item.amount)}</td>
                            {!readOnly && (
                              <td className="py-3 text-right">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    onClick={() => openEditPanel(item)}
                                    className="text-xs text-gray-600 font-medium hover:underline"
                                  >
                                    Edit
                                  </button>
                                  <span className="text-gray-300">·</span>
                                  <button
                                    onClick={() => handleDelete(item)}
                                    className="text-xs text-red-600 font-medium hover:underline"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-gray-200">
                        <tr>
                          <td className="py-3 text-sm font-bold text-navy">Total per student</td>
                          <td className="py-3 text-sm font-bold text-right text-navy">{formatNaira(requiredTotal)}</td>
                          {!readOnly && <td></td>}
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>

                {optionalFees.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-navy font-semibold text-lg">Optional fees</h2>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">
                      Available to students in {selectedClass?.name}.
                      {!readOnly && ' Use "Manage opt-ins" to enroll students from this class.'}
                    </p>

                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Item name</th>
                          <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Opt-ins (total)</th>
                          <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Amount</th>
                          {!readOnly && <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {optionalFees.map(item => (
                          <tr key={item.id}>
                            <td className="py-3">
                              <span className="text-sm text-navy">{item.name}</span>
                              {item.isSchoolWide && (
                                <span className="ml-2 text-xs text-gray-500">(school-wide)</span>
                              )}
                            </td>
                            <td className="py-3 text-sm text-gray-700">
                              {item.optInCount} {item.optInCount === 1 ? 'student' : 'students'}
                            </td>
                            <td className="py-3 text-sm text-right text-navy font-medium">{formatNaira(item.amount)}</td>
                            {!readOnly && (
                              <td className="py-3 text-right">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    onClick={() => openOptIns(item, true)}
                                    className="text-xs text-mint font-medium hover:underline"
                                  >
                                    Manage opt-ins
                                  </button>
                                  <span className="text-gray-300">·</span>
                                  <button
                                    onClick={() => openEditPanel(item)}
                                    className="text-xs text-gray-600 font-medium hover:underline"
                                  >
                                    Edit
                                  </button>
                                  <span className="text-gray-300">·</span>
                                  <button
                                    onClick={() => handleDelete(item)}
                                    className="text-xs text-red-600 font-medium hover:underline"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-gray-200">
                        <tr>
                          <td colSpan={2} className="py-2 text-xs text-gray-500">
                            Per student who opts in to all
                          </td>
                          <td className="py-2 text-xs text-right text-gray-500">{formatNaira(optionalTotal)}</td>
                          {!readOnly && <td></td>}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

              </div>
            </div>
          )}

          {view === 'item' && (
            <div className="space-y-4 mb-6">

              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-navy font-semibold text-lg">Required fees</h2>
                  <p className="text-xs text-gray-500">
                    {requiredGroups.length} {requiredGroups.length === 1 ? 'item' : 'items'}
                  </p>
                </div>

                {requiredGroups.length === 0 ? (
                  <p className="text-gray-500 text-sm py-6 text-center">No required fees yet.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Item name</th>
                        <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Applied to</th>
                        <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Amount</th>
                        <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Total expected</th>
                        {!readOnly && <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {requiredGroups.map(group => (
                        <tr key={group.key}>
                          <td className="py-3 text-sm font-medium text-navy">{group.name}</td>
                          <td className="py-3 text-sm text-gray-700">
                            {group.isSchoolWide ? (
                              <span>School-wide ({totalActiveStudents} students)</span>
                            ) : (
                              <span>{group.totalClasses} {group.totalClasses === 1 ? 'class' : 'classes'}</span>
                            )}
                          </td>
                          <td className="py-3 text-sm text-right text-navy">
                            {group.sameAmount && group.amount !== null
                              ? formatNaira(group.amount)
                              : <span className="text-gray-500 italic">Varies</span>}
                          </td>
                          <td className="py-3 text-sm text-right text-navy font-medium">
                            {formatNaira(group.totalRevenue)}
                          </td>
                          {!readOnly && (
                            <td className="py-3 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => openEditGroupPanel({
                                    name: group.name,
                                    isSchoolWide: group.isSchoolWide,
                                    isOptional: false,
                                  })}
                                  className="text-xs text-mint font-medium hover:underline"
                                >
                                  Edit
                                </button>
                                <span className="text-gray-300">·</span>
                                <button
                                  onClick={() => handleBulkDelete(group.name)}
                                  className="text-xs text-red-600 font-medium hover:underline"
                                >
                                  Delete all
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200">
                      <tr>
                        <td colSpan={3} className="py-3 text-sm font-bold text-navy">Total expected from required fees</td>
                        <td className="py-3 text-sm font-bold text-right text-navy">{formatNaira(requiredRevenueTotal)}</td>
                        {!readOnly && <td></td>}
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {optionalGroups.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-navy font-semibold text-lg">Optional fees</h2>
                    <p className="text-xs text-gray-500">
                      {optionalGroups.length} {optionalGroups.length === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                  {!readOnly && (
                    <p className="text-xs text-gray-500 mb-4">
                      Click &quot;Manage opt-ins&quot; to enroll students. For per-class fees, only students in the applied classes will appear.
                    </p>
                  )}

                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Item name</th>
                        <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Applied to</th>
                        <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Opt-ins</th>
                        <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Amount</th>
                        <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Total expected</th>
                        {!readOnly && <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {optionalGroups.map(group => {
                        const totalOptIns = group.items.reduce((sum, i) => sum + i.optInCount, 0)
                        return (
                          <tr key={group.key}>
                            <td className="py-3 text-sm font-medium text-navy">{group.name}</td>
                            <td className="py-3 text-sm text-gray-700">
                              {group.isSchoolWide ? (
                                <span>School-wide</span>
                              ) : (
                                <span>{group.totalClasses} {group.totalClasses === 1 ? 'class' : 'classes'}</span>
                              )}
                            </td>
                            <td className="py-3 text-sm text-gray-700">
                              {totalOptIns} {totalOptIns === 1 ? 'student' : 'students'}
                            </td>
                            <td className="py-3 text-sm text-right text-navy">
                              {group.sameAmount && group.amount !== null
                                ? formatNaira(group.amount)
                                : <span className="text-gray-500 italic">Varies</span>}
                            </td>
                            <td className="py-3 text-sm text-right text-navy font-medium">
                              {formatNaira(group.totalRevenue)}
                            </td>
                            {!readOnly && (
                              <td className="py-3 text-right">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    onClick={() => openGroupOptIns({ name: group.name, items: group.items })}
                                    className="text-xs text-mint font-medium hover:underline"
                                  >
                                    Manage opt-ins
                                  </button>
                                  <span className="text-gray-300">·</span>
                                  <button
                                    onClick={() => openEditGroupPanel({
                                      name: group.name,
                                      isSchoolWide: group.isSchoolWide,
                                      isOptional: true,
                                    })}
                                    className="text-xs text-gray-600 font-medium hover:underline"
                                  >
                                    Edit
                                  </button>
                                  <span className="text-gray-300">·</span>
                                  <button
                                    onClick={() => handleBulkDelete(group.name)}
                                    className="text-xs text-red-600 font-medium hover:underline"
                                  >
                                    Delete all
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-200">
                      <tr>
                        <td colSpan={4} className="py-3 text-sm font-bold text-navy">Total expected from opt-ins</td>
                        <td className="py-3 text-sm font-bold text-right text-navy">{formatNaira(optionalRevenueTotal)}</td>
                        {!readOnly && <td></td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {panelMode !== null && (
          <FeeFormPanel
            mode={panelMode}
            cycleId={cycle.id}
            classes={classes}
            currentClassId={selectedClassId}
            editItem={editingItem || undefined}
            onClose={closePanel}
            onSuccess={() => { closePanel(); router.refresh() }}
          />
        )}

        {editingGroup && (
          <EditFeeGroupPanel
            cycleId={cycle.id}
            currentName={editingGroup.name}
            isSchoolWide={editingGroup.isSchoolWide}
            isOptional={editingGroup.isOptional}
            classes={classes}
            onClose={closeGroupPanel}
            onSaved={() => { closeGroupPanel(); router.refresh() }}
          />
        )}

        {managingOptInsFor && (
          <ManageOptInsPanel
            feeItemId={managingOptInsFor.id}
            feeItemName={managingOptInsFor.name}
            feeItemAmount={managingOptInsFor.amount}
            scopedToClassId={optInsScopedToClass ? selectedClassId : undefined}
            scopedClassName={optInsScopedToClass ? selectedClass?.name : undefined}
            onClose={closeOptIns}
            onSaved={() => { closeOptIns(); router.refresh() }}
          />
        )}

        {managingOptInsGroup && (
          <ManageOptInsPanel
            feeItemIds={managingOptInsGroup.items.map(i => i.id)}
            groupItems={managingOptInsGroup.items.map(i => ({ id: i.id, classId: i.classId, amount: i.amount }))}
            feeItemName={managingOptInsGroup.name}
            feeItemAmount={managingOptInsGroup.items[0]?.amount || 0}
            onClose={closeOptIns}
            onSaved={() => { closeOptIns(); router.refresh() }}
          />
        )}

      </div>

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          destructive={confirmDialog.destructive}
          confirmLabel="Delete"
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </>
  )
}