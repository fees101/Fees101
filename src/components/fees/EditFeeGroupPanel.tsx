'use client'

import { useState, useEffect, useMemo } from 'react'
import { editFeeGroup, getFeeGroupDetails } from '@/app/(app)/fees/structure/actions'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import { type BillingFrequency, BILLING_FREQUENCY_OPTIONS } from '@/lib/fees/billingFrequency'

interface ClassRow { id: string, name: string, displayOrder: number }

interface ExistingItem {
  id: string
  classId: string | null
  className: string
  classDisplayOrder: number
  amount: number
  optInCount: number
  isDiscountable?: boolean
  billingFrequency?: BillingFrequency
}

interface Props {
  cycleId: string
  currentName: string
  isSchoolWide: boolean
  isOptional: boolean
  classes: ClassRow[]
  onClose: () => void
  onSaved: () => void
}

// Paper-ground palette, matching FeeFormPanel (the Add-fee drawer) and the App
// Shell canvas — the edit drawer is the same drawer, so it reads from the same
// tokens.
const INK = '#201e1d'
const PAPER = '#f3f2f2'
const META = '#605d5d'
const HINT = '#605d5d'
const RULE_SOFT = '#d7d3d3'
const OCHRE = '#8a4805'

// 14px square selection mark — ink border, filled with an inset white ring when
// on (the App Shell .mk). Inline-styled to dodge the WASM Tailwind safelist.
function Mark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        marginTop: 2,
        border: `2px solid ${INK}`,
        background: on ? INK : 'transparent',
        boxShadow: on ? 'inset 0 0 0 2px #fff' : 'none',
        display: 'block',
      }}
    />
  )
}

// Field label: ink, 0.1em tracking — matches the Add-fee drawer's field labels.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, letterSpacing: '0.1em', color: INK, fontWeight: 600, textTransform: 'uppercase', margin: '0 0 6px' }}>
      {children}
    </p>
  )
}

// A bordered radio/checkbox row inside a 2px-ink box (the App Shell .opt).
function OptRow({
  on, onClick, title, hint, last = false,
}: { on: boolean, onClick: () => void, title: string, hint?: string, last?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        width: '100%',
        textAlign: 'left',
        padding: '11px 12px',
        borderBottom: last ? 'none' : `1px solid ${RULE_SOFT}`,
        background: on ? '#eae7e7' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <Mark on={on} />
      <span style={{ display: 'block' }}>
        <span style={{ display: 'block', fontSize: 13, color: INK, fontWeight: 600 }}>{title}</span>
        {hint && <span style={{ display: 'block', fontSize: 12, color: HINT, marginTop: 2 }}>{hint}</span>}
      </span>
    </button>
  )
}

export default function EditFeeGroupPanel({
  cycleId, currentName, isSchoolWide, isOptional, classes, onClose, onSaved
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
  const [isDiscountable, setIsDiscountable] = useState(true)
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>('per_term')

  // Confirmation — shown only when Save would remove classes that have
  // student opt-ins on them (see handleSave). summary (below) has the counts.
  const [confirmRemoveOptIns, setConfirmRemoveOptIns] = useState(false)

  // Load existing data
  useEffect(() => {
    async function load() {
      const result = await getFeeGroupDetails(cycleId, currentName, isSchoolWide, isOptional)
      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }
      const items = result.items as ExistingItem[]
      setExisting(items)
      if (items.length > 0) setIsDiscountable(items[0].isDiscountable !== false)
      if (items.length > 0) setBillingFrequency(items[0].billingFrequency || 'per_term')

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
  }, [cycleId, currentName, isSchoolWide, isOptional])

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

  // Classes arrive already ordered by section then class (getFeeStructure sorts
  // them). Re-sorting by the bare per-section display_order here would interleave
  // sections again, so preserve the order as given.
  const sortedClasses = classes

  // Per-class pricing is only live when the group spans classes, per-class mode
  // is chosen, and something is ticked — mirrors the Add-fee drawer, where the
  // single Amount field hides once each class is priced separately.
  const perClassActive = !isSchoolWide && pricingMode === 'per-class' && selectedClassIds.size > 0

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

  function switchPricing(mode: 'uniform' | 'per-class') {
    if (mode === 'per-class') {
      // Seed a starting amount for every ticked class that has none, so the
      // per-class fields aren't blank the moment they appear.
      const seeded: Record<string, string> = { ...perClassAmounts }
      Array.from(selectedClassIds).forEach(cid => { if (!seeded[cid] && uniformAmount) seeded[cid] = uniformAmount })
      setPerClassAmounts(seeded)
    }
    setPricingMode(mode)
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
      return 'At least one class must be selected. To remove this fee entirely, use Delete instead.'
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
      result = await editFeeGroup(cycleId, {
        currentName,
        newName: name.trim(),
        isSchoolWide: true,
        isOptional,
        uniformAmount: parseInt(uniformAmount),
        selectedClassIds: [],
        isDiscountable,
        billingFrequency,
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

      result = await editFeeGroup(cycleId, {
        currentName,
        newName: name.trim(),
        isSchoolWide: false,
        isOptional,
        uniformAmount: pricingMode === 'uniform' ? parseInt(uniformAmount) : undefined,
        perClassAmounts: pricingMode === 'per-class' ? perClass : undefined,
        selectedClassIds: Array.from(selectedClassIds),
        isDiscountable,
        billingFrequency,
      })
    }

    if (result.error) {
      setError(result.error)
      setSaving(false)
      setConfirmRemoveOptIns(false)
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
      setConfirmRemoveOptIns(true)
      return
    }

    doSave()
  }

  // Detect if anything has actually changed (disable Save if nothing changed)
  const hasChanges = useMemo(() => {
    if (name.trim() !== currentName) return true
    if (existing.length > 0 && isDiscountable !== (existing[0].isDiscountable !== false)) return true
    if (existing.length > 0 && billingFrequency !== (existing[0].billingFrequency || 'per_term')) return true
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
  }, [name, currentName, uniformAmount, pricingMode, selectedClassIds, perClassAmounts, existing, isSchoolWide, summary, isDiscountable, billingFrequency, isOptional])

  const boxStyle: React.CSSProperties = { border: `2px solid ${INK}`, background: '#fff' }

  return (
    <>
      <div className="fixed inset-0 z-50 flex m-anim-fade">
        <div
          className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
          onClick={onClose}
        />

        {/* Same shell as the Add-fee drawer (FeeFormPanel) / AddStudentModal:
            420px, single p-[22px] scroll — header, fields and footer all scroll
            together, no sticky split. */}
        <aside
          style={{ width: '420px', maxWidth: '100%' }}
          className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
        >
          {/* Header row: title + CLOSE, then the subtitle spans below it. */}
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2 className="text-[22px] font-extrabold tracking-[-0.01em]" style={{ color: INK }}>
              Edit a fee
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
            >
              Close
            </button>
          </div>
          <p className="text-[13px] leading-relaxed mb-5" style={{ color: META }}>
            {isSchoolWide
              ? 'Change its name, amount, or how often it bills.'
              : 'Change its name, amounts, which classes it lands on, or how often it bills.'}
          </p>

          {loading ? (
            <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 16 }}>
              <div className="m-loading mb-3" />
              <p className="text-[13px]" style={{ color: META }}>Loading this fee...</p>
            </div>
          ) : (
            /* The 2px ink rule opens the field stack (matches the Add drawer). */
            <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 16 }}>

              {/* FEE NAME */}
              <div style={{ marginBottom: 18 }}>
                <SectionLabel>Fee name</SectionLabel>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  style={{ ...boxStyle, padding: '8px 11px', fontSize: 13, width: '100%', color: INK }}
                />
                <p className="text-[12px] mt-1.5" style={{ color: HINT }}>
                  Parents see this exact wording as a line on their invoice.
                </p>
              </div>

              {/* AMOUNT PER STUDENT — hidden when pricing each class separately */}
              {!perClassActive && (
                <div style={{ marginBottom: 18 }}>
                  <SectionLabel>Amount per student</SectionLabel>
                  <div style={{ display: 'flex', ...boxStyle }}>
                    <span style={{ background: INK, color: PAPER, fontSize: 14, fontWeight: 700, padding: '10px 12px', display: 'flex', alignItems: 'center' }}>₦</span>
                    <input
                      type="number"
                      value={uniformAmount}
                      onChange={(e) => setUniformAmount(e.target.value)}
                      placeholder="100,000"
                      className="m-num"
                      style={{ border: 0, padding: '8px 11px', fontSize: 13, width: '100%', background: '#fff', color: INK }}
                    />
                  </div>
                  <p className="text-[12px] mt-1.5" style={{ color: HINT }}>
                    {isSchoolWide
                      ? `Applies to all ${classes.length} active ${classes.length === 1 ? 'class' : 'classes'}.`
                      : 'Applied to every selected class below.'}
                  </p>
                </div>
              )}

              {/* WHEN — the 3-way frequency */}
              <div style={{ marginBottom: 18 }}>
                <SectionLabel>When</SectionLabel>
                <div style={boxStyle}>
                  {BILLING_FREQUENCY_OPTIONS.map((opt, i) => (
                    <OptRow
                      key={opt.value}
                      on={billingFrequency === opt.value}
                      onClick={() => setBillingFrequency(opt.value)}
                      title={opt.label}
                      hint={opt.hint}
                      last={i === BILLING_FREQUENCY_OPTIONS.length - 1}
                    />
                  ))}
                </div>
              </div>

              {/* Eligible for discounts */}
              <div style={{ ...boxStyle, marginBottom: 18 }}>
                <OptRow
                  on={isDiscountable}
                  onClick={() => setIsDiscountable(v => !v)}
                  title="Eligible for discounts"
                  hint="Sibling and staff discounts can reduce this fee. Turn off for exams or uniforms."
                  last
                />
              </div>

              {/* WHICH CLASSES — per-class groups only (a school-wide fee has no
                  class list; it grows on its own as students are added). */}
              {!isSchoolWide && (
                <div style={{ marginBottom: 18 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <p style={{ fontSize: 11, letterSpacing: '0.1em', color: INK, fontWeight: 600, textTransform: 'uppercase', margin: 0 }}>
                      Applied to <span className="m-num" style={{ color: META }}>({selectedClassIds.size} of {sortedClasses.length})</span>
                    </p>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setSelectedClassIds(new Set(sortedClasses.map(c => c.id)))} className="text-[11px] font-semibold" style={{ color: INK }}>All</button>
                      <button type="button" onClick={() => setSelectedClassIds(new Set())} className="text-[11px] font-semibold" style={{ color: META }}>Clear</button>
                    </div>
                  </div>

                  <div style={{ borderTop: `1px solid ${RULE_SOFT}` }}>
                    {sortedClasses.map(cls => {
                      const selected = selectedClassIds.has(cls.id)
                      const optIns = optInsByClass[cls.id] || 0
                      return (
                        <div
                          key={cls.id}
                          onClick={() => toggleClass(cls.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${RULE_SOFT}`, cursor: 'pointer', opacity: selected ? 1 : 0.4 }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <Mark on={selected} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 13, color: INK }}>{cls.name}</span>
                              {optIns > 0 && <span style={{ display: 'block', fontSize: 12, color: OCHRE }}>{optIns} opted in</span>}
                            </span>
                          </span>
                          {selected && perClassActive && (
                            <input
                              type="number"
                              value={perClassAmounts[cls.id] || ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setPerClassAmount(cls.id, e.target.value)}
                              placeholder="0"
                              className="m-num"
                              style={{ width: 96, border: `2px solid ${INK}`, padding: '4px 8px', fontSize: 13, textAlign: 'right', background: '#fff', color: INK }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Price-per-class toggle — only meaningful across 2+ classes */}
                  {selectedClassIds.size > 1 && (
                    <button
                      type="button"
                      onClick={() => switchPricing(pricingMode === 'per-class' ? 'uniform' : 'per-class')}
                      className="text-[12px] font-semibold"
                      style={{ color: INK, marginTop: 10, textDecoration: 'underline' }}
                    >
                      {pricingMode === 'per-class' ? 'Use one amount for all' : 'Price each class differently'}
                    </button>
                  )}
                </div>
              )}

              {/* Changes to apply — the edit-only ledger, as a left-rule note */}
              {(summary.classesAdded > 0 || summary.classesRemoved > 0 || summary.renamed) && (
                <div style={{ paddingLeft: 12, borderLeft: `2px solid ${INK}`, marginBottom: 18 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: INK, margin: '0 0 4px' }}>Changes to apply</p>
                  {summary.renamed && (
                    <p className="text-[12px]" style={{ color: META, margin: 0 }}>Rename to &quot;{name.trim()}&quot;</p>
                  )}
                  {summary.classesAdded > 0 && (
                    <p className="text-[12px]" style={{ color: META, margin: 0 }}>Add to {summary.classesAdded} new {summary.classesAdded === 1 ? 'class' : 'classes'}</p>
                  )}
                  {summary.classesRemoved > 0 && (
                    <p className="text-[12px]" style={{ color: META, margin: 0 }}>
                      Remove from {summary.classesRemoved} {summary.classesRemoved === 1 ? 'class' : 'classes'}
                      {summary.classesWithOptIns > 0 && (
                        <span style={{ color: OCHRE }}> ({summary.classesWithOptIns} opt-ins affected)</span>
                      )}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div style={{ paddingLeft: 12, borderLeft: `2px solid var(--color-signal)`, marginBottom: 18 }}>
                  <p className="text-[13px]" style={{ color: 'var(--color-signal-text)' }}>{error}</p>
                </div>
              )}

              {/* Footer — scrolls with the content, like the Add drawer */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleSave} disabled={saving || !hasChanges} className="m-btn m-btn-primary" style={{ flex: 1 }}>
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
                <button onClick={onClose} disabled={saving} className="m-btn m-btn-outline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {confirmRemoveOptIns && (
        <DestructiveConfirmModal
          eyebrow="This cannot be undone"
          title={`Remove ${name.trim() || currentName} from ${summary.classesRemoved} ${summary.classesRemoved === 1 ? 'class' : 'classes'}?`}
          description="Those classes stop being charged this fee from now on. Any student opt-ins already recorded for them are deleted, not just hidden."
          rows={[
            { label: 'Classes losing this fee', value: summary.classesRemoved },
            { label: 'Student opt-ins deleted', value: summary.classesWithOptIns, valueClassName: 'text-sm font-semibold m-num text-[var(--color-signal-text)]', emphasize: true },
          ]}
          note="Invoices already generated for those students are not changed by this — only fees set up from here on."
          error={error}
          actions={[
            { label: 'Cancel', onClick: () => setConfirmRemoveOptIns(false), variant: 'outline', disabled: saving },
            { label: saving ? 'Saving...' : 'Remove and save', onClick: doSave, variant: 'danger', disabled: saving },
          ]}
        />
      )}
    </>
  )
}
