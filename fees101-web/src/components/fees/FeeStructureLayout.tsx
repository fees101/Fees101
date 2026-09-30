'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import FeeFormPanel from './FeeFormPanel'
import ManageOptInsPanel from './ManageOptInsPanel'
import EditFeeGroupPanel from './EditFeeGroupPanel'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import Toast from '@/components/ui/Toast'
import { bulkDeleteFeeItemByName, copyFeesFromLastTerm } from '@/app/(app)/fees/structure/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'
import type { BillingFrequency } from '@/lib/fees/billingFrequency'

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
  isRecurring?: boolean
  billingFrequency?: BillingFrequency
  optInCount: number
}
interface Cycle { id: string, name: string, status: string }

interface Data {
  cycle: Cycle | null
  classes: ClassRow[]
  allFees: FeeItem[]
  studentCountByClass: Record<string, number>
  totalActiveStudents: number
  issuedInvoiceCount: number
}

interface Props {
  data: Data
  initialView?: 'class' | 'item'
  initialClassId?: string
  readOnly?: boolean
  // When false (no see-financial-totals), the Gross Potential aggregate is
  // redacted with the same "—" convention CyclesLayout uses for its
  // billed/collected figures. Defaults true so existing call sites (if any)
  // that don't pass it keep today's behaviour.
  showFinancials?: boolean
}

// Paper-ground palette (the fee structure is an operating surface, ink on
// paper). Kept as constants so the matrix header, rows and totals stay in
// lockstep, and the inline grid template sidesteps the WASM Tailwind
// arbitrary-utility gotcha.
const INK = '#201e1d'
const META = '#605d5d'
const BODY = '#444141'
const DIM = '#9b9797'
const RULE_SOFT = '#d7d3d3'

function formatNaira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

// Bare number for the matrix cells (the mock prints "142,000", not "₦142,000"
// — the ₦ lives in the hero total and the totals row only).
function formatCell(amount: number): string {
  return Math.round(amount).toLocaleString('en-NG')
}

export default function FeeStructureLayout({ data, initialClassId, readOnly: readOnlyProp = false, showFinancials = true }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const canManageFeeStructure = useCan('manage-fee-structure')
  // Read-only if the caller says so (e.g. a closed term) OR the user lacks
  // manage-fee-structure — a see-fee-structure-only user can view but not edit.
  const readOnly = readOnlyProp || !canManageFeeStructure
  const { cycle, classes, allFees, studentCountByClass, totalActiveStudents, issuedInvoiceCount } = data

  // Arrived here via a term's "Edit fees" link, which carries a from= param
  // so there's a way back instead of the page just substituting whatever was
  // on screen before. Only trusted for our own /fees/ routes.
  const fromParam = searchParams.get('from')
  const backHref = fromParam && fromParam.startsWith('/fees/') ? fromParam : null

  // Only used as the default class for the "Add fee" panel; the panel itself
  // lets the user pick scope/classes.
  const [selectedClassId] = useState<string>(initialClassId || classes[0]?.id || '')

  const [panelMode, setPanelMode] = useState<'add' | 'edit' | null>(null)
  const [editingItem, setEditingItem] = useState<FeeItem | null>(null)
  const [editingGroup, setEditingGroup] = useState<{
    name: string
    isSchoolWide: boolean
    isOptional: boolean
  } | null>(null)
  const [managingOptInsGroup, setManagingOptInsGroup] = useState<{
    name: string
    items: FeeItem[]
  } | null>(null)
  // Stable references while the panel is open — ManageOptInsPanel's initial
  // load re-runs whenever feeItemIds changes identity, so a fresh .map() on
  // every FeeStructureLayout render (e.g. from an unrelated toast/error state
  // update) would silently reset any unsaved opt-in selection.
  const managingOptInsFeeItemIds = useMemo(
    () => managingOptInsGroup?.items.map(i => i.id) ?? [],
    [managingOptInsGroup]
  )
  const managingOptInsGroupItems = useMemo(
    () => managingOptInsGroup?.items.map(i => ({ id: i.id, classId: i.classId, amount: i.amount })) ?? [],
    [managingOptInsGroup]
  )
  // Re-home: a fee row is clickable and opens its Edit / Manage opt-ins /
  // Delete actions in the right rail (the mock has no inline row action cluster,
  // so the row itself is the affordance).
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    destructive?: boolean
    onConfirm: () => Promise<void>
  } | null>(null)
  // Deleting fees by name destroys fee items and opt-ins outright, so it gets
  // the itemized DestructiveConfirmModal rather than the plain ConfirmDialog
  // above (still used for the non-destructive "copy from last term").
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<{ name: string; count: number; totalOptIns: number } | null>(null)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)

  function revenueFor(item: FeeItem): number {
    if (item.isOptional) return item.amount * item.optInCount
    if (item.isSchoolWide) return item.amount * totalActiveStudents
    if (item.classId) return item.amount * (studentCountByClass[item.classId] || 0)
    return 0
  }

  // Group fee items by name + scope + required/optional, in first-seen order,
  // and lay each group out as one cell per class. A school-wide fee shows its
  // single amount in every column; a per-class fee shows its amount where it
  // applies and blank ("—") elsewhere.
  const matrix = useMemo(() => {
    interface Group {
      key: string
      name: string
      items: FeeItem[]
      isSchoolWide: boolean
      isOptional: boolean
      totalOptIns: number
      totalRevenue: number
      cells: (number | null)[]
    }
    const map = new Map<string, Group>()
    for (const f of allFees) {
      const scope = f.isSchoolWide ? 'school' : 'class'
      const key = `${f.name}::${scope}::${f.isRequired ? 'req' : 'opt'}`
      let g = map.get(key)
      if (!g) {
        g = {
          key,
          name: f.name,
          items: [],
          isSchoolWide: f.isSchoolWide,
          isOptional: f.isOptional,
          totalOptIns: 0,
          totalRevenue: 0,
          cells: [],
        }
        map.set(key, g)
      }
      g.items.push(f)
      g.totalOptIns += f.optInCount
      g.totalRevenue += revenueFor(f)
    }
    const groups = Array.from(map.values())
    for (const g of groups) {
      if (g.isSchoolWide) {
        const amt = g.items[0]?.amount ?? null
        g.cells = classes.map(() => amt)
      } else {
        const byClass = new Map<string, number>()
        g.items.forEach(i => { if (i.classId) byClass.set(i.classId, i.amount) })
        g.cells = classes.map(c => byClass.get(c.id) ?? null)
      }
    }
    const required = groups.filter(g => !g.isOptional)
    const optional = groups.filter(g => g.isOptional)
    // Per-student total row = required fees only (an opt-in isn't billed unless
    // the student opts in), matching the mock's bold "Per student" row.
    const perStudent = classes.map((_, ci) =>
      required.reduce((sum, g) => sum + (g.cells[ci] ?? 0), 0)
    )
    const requiredRevenue = required.reduce((s, g) => s + g.totalRevenue, 0)
    const optionalRevenue = optional.reduce((s, g) => s + g.totalRevenue, 0)
    return { required, optional, perStudent, grossPotential: requiredRevenue + optionalRevenue }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFees, classes, studentCountByClass, totalActiveStudents])

  const feeCount = matrix.required.length + matrix.optional.length
  const allGroups = [...matrix.required, ...matrix.optional]
  const selectedGroup = allGroups.find(g => g.key === selectedGroupKey) || null

  // A single honest read of the matrix, standing where the canvas puts its
  // insight line. The design's job for this surface is "did we raise JSS 2 but
  // forget SS 1 — answerable by looking", so the first thing worth flagging is
  // a required fee that covers some classes but not all (a likely omission).
  // Absent any gap, report the real per-student spread. No cross-term or
  // collection figures are invented — only what this term's fees actually say.
  const insight = useMemo((): { tone: 'ochre' | 'meta'; text: string } | null => {
    const total = classes.length
    if (total === 0 || matrix.required.length === 0) return null

    const gapped = matrix.required
      .filter(g => !g.isSchoolWide)
      .map(g => ({ name: g.name, covered: g.cells.filter(v => v !== null).length }))
      .filter(g => g.covered > 0 && g.covered < total)
      .sort((a, b) => a.covered - b.covered)

    if (gapped.length > 0) {
      const g = gapped[0]
      const missing = total - g.covered
      const more = gapped.length > 1 ? ` (${gapped.length} fees have blanks)` : ''
      return {
        tone: 'ochre',
        text: `${g.name} is billed to ${g.covered} of ${total} classes. Confirm the ${missing} blank ${missing === 1 ? 'cell is' : 'cells are'} intentional${more}.`,
      }
    }

    const totals = matrix.perStudent
    if (totals.length === 0) return null
    const max = Math.max(...totals)
    const min = Math.min(...totals)
    if (max === min) {
      return { tone: 'meta', text: `Every class carries the same required total of ${formatNaira(max)} per student.` }
    }
    const maxIdx = totals.indexOf(max)
    const minIdx = totals.indexOf(min)
    return {
      tone: 'meta',
      text: `Required totals run ${formatNaira(min)} (${classes[minIdx]?.name}) to ${formatNaira(max)} (${classes[maxIdx]?.name}) per student.`,
    }
  }, [matrix, classes])

  function handleBulkDelete(name: string) {
    if (readOnly || !cycle) return
    setError(null)
    setBulkDeleteError(null)
    const matches = allFees.filter(f => f.name === name)
    const count = matches.length
    const totalOptIns = matches.reduce((sum, f) => sum + f.optInCount, 0)
    setBulkDeleteConfirm({ name, count, totalOptIns })
  }

  async function confirmBulkDelete() {
    if (!cycle || !bulkDeleteConfirm) return
    setBulkDeleteBusy(true)
    setBulkDeleteError(null)
    const result = await bulkDeleteFeeItemByName(cycle.id, bulkDeleteConfirm.name)
    setBulkDeleteBusy(false)
    if (result.error) {
      setBulkDeleteError(result.error)
      return
    }
    setBulkDeleteConfirm(null)
    router.refresh()
  }

  function handleCopyFromLastTerm() {
    if (readOnly || !cycle || copying) return
    setError(null)
    setConfirmDialog({
      title: 'Copy fees from the previous term?',
      message: 'Every fee from the term before this one is added here. Fees already in this term are kept as they are, and student opt-ins are not copied.',
      onConfirm: async () => {
        setConfirmDialog(null)
        setCopying(true)
        const result = await copyFeesFromLastTerm(cycle.id)
        setCopying(false)
        if (result.error) {
          setToast({ message: result.error, ok: false })
        } else {
          setToast({ message: `Copied ${result.copied} ${result.copied === 1 ? 'fee' : 'fees'} from ${result.fromTerm}.`, ok: true })
          router.refresh()
        }
      },
    })
  }

  function closeAllPanels() {
    setPanelMode(null)
    setEditingItem(null)
    setEditingGroup(null)
    setManagingOptInsGroup(null)
    setSelectedGroupKey(null)
  }

  function openAddPanel() {
    if (readOnly) return
    closeAllPanels()
    setEditingItem(null)
    setPanelMode('add')
  }

  function openEditGroupPanel(group: { name: string, isSchoolWide: boolean, isOptional: boolean }) {
    if (readOnly) return
    setPanelMode(null)
    setEditingItem(null)
    setManagingOptInsGroup(null)
    setSelectedGroupKey(null)
    setEditingGroup(group)
  }

  function openGroupOptIns(group: { name: string, items: FeeItem[] }) {
    if (readOnly) return
    setPanelMode(null)
    setEditingItem(null)
    setEditingGroup(null)
    setSelectedGroupKey(null)
    setManagingOptInsGroup(group)
  }

  function selectRow(key: string) {
    if (readOnly) return
    setPanelMode(null)
    setEditingItem(null)
    setEditingGroup(null)
    setManagingOptInsGroup(null)
    setSelectedGroupKey(prev => (prev === key ? null : key))
  }

  if (!cycle) {
    return (
      <div className="py-16 text-center border-2 border-dashed border-[var(--color-neutral-300)]">
        <p className="text-sm text-[var(--color-neutral-700)] mb-4">No active billing cycle. Create a term first.</p>
        <Link href="/fees/cycles" className="m-btn m-btn-primary">Create a term</Link>
      </div>
    )
  }

  const gridCols = `minmax(150px,1.6fr) repeat(${classes.length}, minmax(78px,1fr))`
  const gridMinWidth = 150 + classes.length * 86
  // Add fee (FeeFormPanel) and Edit fee (EditFeeGroupPanel) both open as a
  // right-edge slide-over overlay, like Add students — so neither claims a grid
  // column. Only the remaining inline rail panels (opt-ins, the selected-group
  // actions) widen the grid.
  const sidePanelOpen = managingOptInsGroup !== null || (selectedGroup !== null && !readOnly)

  const renderRow = (g: typeof allGroups[number]) => {
    const isSelected = selectedGroupKey === g.key
    return (
      <div
        key={g.key}
        onClick={readOnly ? undefined : () => selectRow(g.key)}
        className="grid items-baseline"
        style={{
          gridTemplateColumns: gridCols,
          gap: 8,
          minWidth: gridMinWidth,
          padding: '10px 0',
          borderBottom: `1px solid ${RULE_SOFT}`,
          cursor: readOnly ? 'default' : 'pointer',
          background: isSelected ? 'var(--color-surface)' : undefined,
        }}
      >
        <span className="text-[14px] font-semibold" style={{ color: INK }}>{g.name}</span>
        {g.cells.map((v, i) => (
          <span
            key={i}
            className="m-num text-right text-[13px]"
            style={{ color: v === null ? DIM : INK }}
          >
            {v === null ? '—' : formatCell(v)}
          </span>
        ))}
      </div>
    )
  }

  return (
    <>
      {backHref && (
        <Link href={backHref} className="inline-flex items-center gap-1 text-[13px] font-semibold hover:underline mb-4" style={{ color: 'var(--color-ink)' }}>
          &larr; Back to {cycle.name}
        </Link>
      )}
      <div className={`grid gap-6 grid-cols-1 ${sidePanelOpen ? 'lg:grid-cols-[1fr_380px]' : ''}`}>
        <div className="min-w-0 m-anim-fade">
          {/* Hero */}
          <div className="flex flex-wrap items-end justify-between gap-5 mb-[18px]">
            <div>
              <p className="text-[11px] tracking-[0.16em] mb-2" style={{ color: META }}>
                GROSS POTENTIAL · {cycle.name.toUpperCase()}
              </p>
              <p className="m-num text-[40px] font-extrabold" style={{ lineHeight: 0.92, letterSpacing: '-0.03em', color: INK }}>
                {showFinancials ? formatNaira(matrix.grossPotential) : '—'}
              </p>
              <p className="text-[13px] mt-1.5" style={{ color: META }}>
                {feeCount} {feeCount === 1 ? 'fee' : 'fees'} across {classes.length} {classes.length === 1 ? 'class' : 'classes'} · before discounts
              </p>
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                <button onClick={openAddPanel} className="m-btn m-btn-primary">Add fee</button>
                <button onClick={handleCopyFromLastTerm} disabled={copying} className="m-btn m-btn-primary">
                  {copying ? 'Copying...' : 'Copy from last term'}
                </button>
              </div>
            )}
          </div>

          <p className="text-[14px] mb-5" style={{ color: BODY, maxWidth: '78ch' }}>
            Every price for every class on one surface. A blank cell means the fee doesn&apos;t apply to that class.
            {!readOnly && ' Select a fee to edit it, manage its opt-ins, or remove it.'}
          </p>

          {error && (
            <div className="mb-5 pl-4 py-3 border-l-2 border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {error}
            </div>
          )}

          {feeCount === 0 ? (
            <div className="py-12 border-t-2" style={{ borderColor: INK, maxWidth: '60ch' }}>
              <p className="text-[17px] font-bold mb-2" style={{ color: INK }}>No fees set up</p>
              <p className="text-[14px] leading-[1.55] mb-4" style={{ color: BODY }}>
                This blocks billing entirely: until at least one fee exists, no invoice can be generated for
                this term. Add the first fee by hand, or copy the whole structure across if you ran a previous term.
              </p>
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={openAddPanel} className="m-btn m-btn-primary">Add first fee</button>
                  <button onClick={handleCopyFromLastTerm} disabled={copying} className="m-btn m-btn-outline">
                    {copying ? 'Copying...' : 'Copy from last term'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Column header */}
              <div
                className="grid"
                style={{ gridTemplateColumns: gridCols, gap: 8, minWidth: gridMinWidth, padding: '0 0 8px', borderBottom: `2px solid ${INK}` }}
              >
                <span className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: META }}>FEE</span>
                {classes.map(c => (
                  <span key={c.id} className="text-right text-[11px] font-semibold tracking-[0.06em]" style={{ color: META }}>{c.name}</span>
                ))}
              </div>

              {/* REQUIRED */}
              {matrix.required.length > 0 && (
                <>
                  <div style={{ minWidth: gridMinWidth, padding: '16px 0 6px', borderBottom: `1px solid ${RULE_SOFT}` }}>
                    <span className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: INK }}>REQUIRED</span>
                    <span className="text-[11px] ml-2" style={{ color: META }}>billed to every student in the class</span>
                  </div>
                  {matrix.required.map(renderRow)}
                </>
              )}

              {/* OPT-IN */}
              {matrix.optional.length > 0 && (
                <>
                  <div style={{ minWidth: gridMinWidth, padding: '16px 0 6px', borderBottom: `1px solid ${RULE_SOFT}` }}>
                    <span className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: INK }}>OPT-IN</span>
                    <span className="text-[11px] ml-2" style={{ color: META }}>billed only where a student opts in</span>
                  </div>
                  {matrix.optional.map(renderRow)}
                </>
              )}

              {/* Per student totals (required only) */}
              <div
                className="grid"
                style={{ gridTemplateColumns: gridCols, gap: 8, minWidth: gridMinWidth, padding: '12px 0 0', borderTop: `2px solid ${INK}` }}
              >
                <span className="text-[13px] font-extrabold" style={{ color: INK }}>Per student</span>
                {matrix.perStudent.map((t, i) => (
                  <span key={i} className="m-num text-right text-[13px] font-extrabold" style={{ color: INK }}>{formatCell(t)}</span>
                ))}
              </div>
            </div>
          )}

          {insight && feeCount > 0 && (
            <p
              className="text-[14px] m-num"
              style={{
                marginTop: 18,
                maxWidth: '78ch',
                color: insight.tone === 'ochre' ? 'var(--color-ochre-text)' : META,
                fontWeight: insight.tone === 'ochre' ? 600 : 400,
              }}
            >
              {insight.text}
            </p>
          )}
        </div>

        {/* Right rail — re-homed row actions and the existing editor panels */}
        {selectedGroup && !readOnly && panelMode === null && !editingGroup && !managingOptInsGroup && (
          <aside className="border-2 p-5 h-fit lg:sticky lg:top-24 m-anim-fade" style={{ borderColor: INK }}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <p className="text-[15px] font-extrabold" style={{ color: INK }}>{selectedGroup.name}</p>
              <button
                onClick={() => setSelectedGroupKey(null)}
                className="text-[11px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: META }}
              >
                Close
              </button>
            </div>
            <p className="text-[12px] mb-4" style={{ color: META }}>
              {selectedGroup.isSchoolWide ? 'School-wide' : `${selectedGroup.items.length} ${selectedGroup.items.length === 1 ? 'class' : 'classes'}`}
              {selectedGroup.isOptional && ` · ${selectedGroup.totalOptIns} ${selectedGroup.totalOptIns === 1 ? 'opt-in' : 'opt-ins'}`}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => openEditGroupPanel({ name: selectedGroup.name, isSchoolWide: selectedGroup.isSchoolWide, isOptional: selectedGroup.isOptional })}
                className="m-btn m-btn-outline w-full"
              >
                Edit fee
              </button>
              {selectedGroup.isOptional && (
                <button
                  onClick={() => openGroupOptIns({ name: selectedGroup.name, items: selectedGroup.items })}
                  className="m-btn m-btn-outline w-full"
                >
                  Manage opt-ins
                </button>
              )}
              <button
                onClick={() => handleBulkDelete(selectedGroup.name)}
                className="m-btn m-btn-danger w-full"
              >
                Delete fee
              </button>
            </div>
          </aside>
        )}

        {panelMode !== null && (
          <FeeFormPanel
            mode={panelMode}
            cycleId={cycle.id}
            classes={classes}
            currentClassId={selectedClassId}
            editItem={editingItem || undefined}
            studentCountByClass={studentCountByClass}
            totalActiveStudents={totalActiveStudents}
            issuedInvoiceCount={issuedInvoiceCount}
            onClose={() => { setPanelMode(null); setEditingItem(null) }}
            onSuccess={() => { setPanelMode(null); setEditingItem(null); router.refresh() }}
          />
        )}

        {editingGroup && (
          <EditFeeGroupPanel
            cycleId={cycle.id}
            currentName={editingGroup.name}
            isSchoolWide={editingGroup.isSchoolWide}
            isOptional={editingGroup.isOptional}
            classes={classes}
            onClose={() => setEditingGroup(null)}
            onSaved={() => { setEditingGroup(null); router.refresh() }}
          />
        )}

        {managingOptInsGroup && (
          <ManageOptInsPanel
            feeItemIds={managingOptInsFeeItemIds}
            groupItems={managingOptInsGroupItems}
            feeItemName={managingOptInsGroup.name}
            feeItemAmount={managingOptInsGroup.items[0]?.amount || 0}
            onClose={() => setManagingOptInsGroup(null)}
            onSaved={() => { setManagingOptInsGroup(null); router.refresh() }}
          />
        )}
      </div>

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          destructive={confirmDialog.destructive}
          confirmLabel={confirmDialog.destructive ? 'Delete' : 'Confirm'}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {bulkDeleteConfirm && (
        <DestructiveConfirmModal
          eyebrow="This cannot be undone"
          title={`Delete all "${bulkDeleteConfirm.name}" fees?`}
          description="Removes this fee from every class it's set up on for this term."
          rows={[
            { label: 'Fee items removed', value: bulkDeleteConfirm.count },
            { label: 'Student opt-ins removed', value: bulkDeleteConfirm.totalOptIns, emphasize: true },
          ]}
          note="Invoices already generated are not changed — this only affects fees set up from here on."
          error={bulkDeleteError}
          actions={[
            { label: 'Cancel', onClick: () => setBulkDeleteConfirm(null), variant: 'outline', disabled: bulkDeleteBusy },
            { label: bulkDeleteBusy ? 'Deleting...' : 'Delete', onClick: confirmBulkDelete, variant: 'danger', disabled: bulkDeleteBusy },
          ]}
        />
      )}

      {toast && (
        <Toast message={toast.message} ok={toast.ok} onDismiss={() => setToast(null)} />
      )}
    </>
  )
}
