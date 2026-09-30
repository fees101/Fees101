'use client'

import { useMemo, useState } from 'react'
import { addFeeItem, updateFeeItem } from '@/app/(app)/fees/structure/actions'
import { type BillingFrequency, BILLING_FREQUENCY_OPTIONS } from '@/lib/fees/billingFrequency'

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
}

interface Props {
  mode: 'add' | 'edit'
  cycleId: string
  classes: ClassRow[]
  currentClassId?: string
  editItem?: FeeItem
  // Headcounts + already-sent count drive the "what this will do" ledger so the
  // person adding a fee sees who it lands on before they commit.
  studentCountByClass?: Record<string, number>
  totalActiveStudents?: number
  issuedInvoiceCount?: number
  onClose: () => void
  onSuccess: () => void
}

// Paper-ground palette, matching FeeStructureLayout and the App Shell canvas.
const INK = '#201e1d'
const PAPER = '#f3f2f2'
const META = '#605d5d'
const HINT = '#605d5d'
const RULE_SOFT = '#d7d3d3'
const GREEN = '#0a6b3d'
const OCHRE = '#8a4805'
const DIM = '#9b9797'

function naira(n: number): string {
  return '₦' + Math.round(n).toLocaleString('en-NG')
}

// 14px square selection mark, ink border, filled with an inset white ring when
// on — the App Shell .mk. Inline-styled to dodge the WASM Tailwind safelist.
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

// Field label: ink, 0.1em tracking — matches the canvas field labels and
// AddStudentModal's labelCls. (The "WHAT THIS WILL DO" eyebrow is a separate,
// dimmer 0.14em label, inlined where it's used.)
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

export default function FeeFormPanel({
  mode, cycleId, classes, currentClassId, editItem,
  studentCountByClass = {}, totalActiveStudents = 0, issuedInvoiceCount = 0,
  onClose, onSuccess,
}: Props) {
  const isEdit = mode === 'edit'

  const [name, setName] = useState(editItem?.name || '')
  const [amount, setAmount] = useState(editItem ? String(editItem.amount) : '')
  const [isRequired, setIsRequired] = useState(editItem ? editItem.isRequired : true)
  const [isDiscountable, setIsDiscountable] = useState(editItem ? editItem.isDiscountable !== false : true)
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>(editItem?.billingFrequency || 'per_term')

  // "All students · school-wide" is one fee row with no class (it grows on its
  // own as students are added). Otherwise the fee spans the ticked classes.
  const [schoolWide, setSchoolWide] = useState(editItem ? editItem.isSchoolWide : false)
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(
    new Set(!editItem && currentClassId ? [currentClassId] : [])
  )
  // Per-class pricing only matters for a multi-class add where the price differs
  // by class (the matrix mental model). Off by default; on reveals a price field
  // beside each ticked class in place of the single amount.
  const [pricingMode, setPricingMode] = useState<'uniform' | 'per-class'>('uniform')
  const [perClassAmounts, setPerClassAmounts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const perClassActive = !isEdit && !schoolWide && pricingMode === 'per-class' && selectedClassIds.size > 0

  function toggleClass(classId: string) {
    if (isEdit) return
    setSchoolWide(false)
    const next = new Set(selectedClassIds)
    if (next.has(classId)) {
      next.delete(classId)
    } else {
      next.add(classId)
      if (pricingMode === 'per-class' && !perClassAmounts[classId] && amount) {
        setPerClassAmounts(prev => ({ ...prev, [classId]: amount }))
      }
    }
    setSelectedClassIds(next)
  }

  function chooseSchoolWide() {
    if (isEdit) return
    setSchoolWide(true)
    setSelectedClassIds(new Set())
    setPricingMode('uniform')
  }

  function selectAllClasses() {
    setSchoolWide(false)
    setSelectedClassIds(new Set(classes.map(c => c.id)))
    if (pricingMode === 'per-class' && amount) {
      const seeded: Record<string, string> = { ...perClassAmounts }
      classes.forEach(c => { if (!seeded[c.id]) seeded[c.id] = amount })
      setPerClassAmounts(seeded)
    }
  }

  function switchPricing(mode: 'uniform' | 'per-class') {
    if (mode === 'per-class' && amount) {
      const seeded: Record<string, string> = { ...perClassAmounts }
      Array.from(selectedClassIds).forEach(cid => { if (!seeded[cid]) seeded[cid] = amount })
      setPerClassAmounts(seeded)
    }
    setPricingMode(mode)
  }

  // ── "What this will do" ledger ──────────────────────────────────────────
  const ledger = useMemo(() => {
    const uniform = parseInt(amount) || 0

    // Who gets billed. An opt-in fee bills nobody until students opt in.
    let studentsBilled = 0
    if (schoolWide) {
      studentsBilled = totalActiveStudents
    } else {
      for (const cid of Array.from(selectedClassIds)) {
        studentsBilled += studentCountByClass[cid] || 0
      }
    }
    const billedNow = isRequired ? studentsBilled : 0

    // What it adds to this term's gross potential (before discounts).
    let grossAdded = 0
    if (isRequired) {
      if (perClassActive) {
        for (const cid of Array.from(selectedClassIds)) {
          const a = parseInt(perClassAmounts[cid] || '') || 0
          grossAdded += a * (studentCountByClass[cid] || 0)
        }
      } else {
        grossAdded = uniform * studentsBilled
      }
    }

    return { billedNow, grossAdded, optIn: !isRequired, eligible: studentsBilled }
  }, [amount, schoolWide, selectedClassIds, studentCountByClass, totalActiveStudents, isRequired, perClassActive, perClassAmounts])

  async function handleSubmit() {
    if (!name.trim()) { setError('Fee name is required'); return }

    if (perClassActive) {
      if (selectedClassIds.size === 0) { setError('Select at least one class'); return }
      for (const cid of Array.from(selectedClassIds)) {
        const a = parseInt(perClassAmounts[cid] || '')
        if (isNaN(a) || a <= 0) {
          const cls = classes.find(c => c.id === cid)
          setError(`Enter an amount for ${cls?.name || 'each selected class'}`)
          return
        }
      }
    } else {
      const amt = parseInt(amount)
      if (isNaN(amt) || amt <= 0) { setError('Amount must be greater than 0'); return }
    }

    if (!isEdit && !schoolWide && selectedClassIds.size === 0) {
      setError('Choose school-wide, or tick at least one class')
      return
    }

    setError(null)
    setLoading(true)

    let result
    if (isEdit) {
      result = await updateFeeItem(editItem!.id, {
        name,
        amount: parseInt(amount),
        isDiscountable,
        billingFrequency,
      })
    } else {
      const perClass: Record<string, number> = {}
      if (perClassActive) {
        Array.from(selectedClassIds).forEach(cid => {
          const a = parseInt(perClassAmounts[cid] || '')
          if (!isNaN(a) && a > 0) perClass[cid] = a
        })
      }
      result = await addFeeItem(cycleId, {
        name,
        amount: perClassActive ? 0 : parseInt(amount),
        isRequired,
        scope: schoolWide ? 'all-school' : 'multiple',
        classIds: schoolWide ? [] : Array.from(selectedClassIds),
        ...(perClassActive ? { perClassAmounts: perClass } : {}),
        isDiscountable,
        billingFrequency,
      })
    }

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    onSuccess()
  }

  const boxStyle: React.CSSProperties = { border: `2px solid ${INK}`, background: '#fff' }

  return (
    <div className="fixed inset-0 z-50 flex m-anim-fade">
      <div
        className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
        onClick={onClose}
      />

      {/* Same shell as AddStudentModal: 420px, single p-[22px] scroll (header,
          fields and footer all scroll together — no sticky split). */}
      <aside
        style={{ width: '420px', maxWidth: '100%' }}
        className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
      >
        {/* Header row: title + CLOSE, then the subtitle spans below it. */}
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em]" style={{ color: INK }}>
            {isEdit ? 'Edit a fee' : 'Add a fee'}
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
          {isEdit
            ? 'Change what this fee is called, its amount, or how often it bills.'
            : 'One fee, its price, who it lands on, and how often it bills.'}
        </p>

        {/* The 2px ink rule opens the field stack (matches the canvas). */}
        <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 16 }}>

          {/* FEE NAME */}
          <div style={{ marginBottom: 18 }}>
            <SectionLabel>Fee name</SectionLabel>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isRequired ? 'e.g. Tuition, Development levy, PTA' : 'e.g. Bus fee, Lunch, Chess club'}
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
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100,000"
                  className="m-num"
                  style={{ border: 0, borderLeft: 0, padding: '8px 11px', fontSize: 13, width: '100%', background: '#fff', color: INK }}
                />
              </div>
            </div>
          )}

          {/* HOW IT IS BILLED — add only (an item's type is fixed once created) */}
          {!isEdit && (
            <div style={{ marginBottom: 18 }}>
              <SectionLabel>How it is billed</SectionLabel>
              <div style={boxStyle}>
                <OptRow
                  on={isRequired}
                  onClick={() => setIsRequired(true)}
                  title="Compulsory"
                  hint="Charged automatically to every student it applies to."
                />
                <OptRow
                  on={!isRequired}
                  onClick={() => setIsRequired(false)}
                  title="Opt-in"
                  hint="Only billed to students you enrol, one by one."
                  last
                />
              </div>
            </div>
          )}

          {/* WHEN — the 3-way frequency, for every fee */}
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

          {/* WHICH CLASSES — add only (scope is fixed on a single-item edit) */}
          {!isEdit && (
            <div style={{ marginBottom: 18 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 11, letterSpacing: '0.1em', color: INK, fontWeight: 600, textTransform: 'uppercase', margin: 0 }}>Which classes</p>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={selectAllClasses} className="text-[11px] font-semibold" style={{ color: INK }}>All</button>
                  <button type="button" onClick={() => { setSchoolWide(false); setSelectedClassIds(new Set()) }} className="text-[11px] font-semibold" style={{ color: META }}>Clear</button>
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${RULE_SOFT}` }}>
                {/* School-wide row */}
                <button
                  type="button"
                  onClick={chooseSchoolWide}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${RULE_SOFT}`, cursor: 'pointer', background: 'transparent' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Mark on={schoolWide} />
                    <span style={{ fontSize: 13, color: INK, fontWeight: 600 }}>All students · school-wide</span>
                  </span>
                  <span className="m-num" style={{ fontSize: 12, color: schoolWide ? INK : META }}>{totalActiveStudents}</span>
                </button>

                {/* Per-class rows */}
                {classes.map(cls => {
                  const selected = !schoolWide && selectedClassIds.has(cls.id)
                  const count = studentCountByClass[cls.id] || 0
                  return (
                    <div
                      key={cls.id}
                      onClick={() => toggleClass(cls.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${RULE_SOFT}`, cursor: 'pointer', opacity: schoolWide ? 0.4 : 1 }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Mark on={selected} />
                        <span style={{ fontSize: 13, color: INK }}>{cls.name}</span>
                      </span>
                      {selected && perClassActive ? (
                        <input
                          type="number"
                          value={perClassAmounts[cls.id] || ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPerClassAmounts(prev => ({ ...prev, [cls.id]: e.target.value }))}
                          placeholder="0"
                          className="m-num"
                          style={{ width: 96, border: `2px solid ${INK}`, padding: '4px 8px', fontSize: 13, textAlign: 'right', background: '#fff', color: INK }}
                        />
                      ) : (
                        <span className="m-num" style={{ fontSize: 12, color: count === 0 ? DIM : META }}>{count}</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Price-per-class toggle — only meaningful across 2+ classes */}
              {!schoolWide && selectedClassIds.size > 1 && (
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

          {/* WHAT THIS WILL DO */}
          <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 14, marginBottom: 18 }}>
            <p style={{ fontSize: 11, letterSpacing: '0.14em', color: META, textTransform: 'uppercase', margin: '0 0 10px' }}>What this will do</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', rowGap: 10, columnGap: 16, alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, color: META }}>Students billed now</span>
              <span className="m-num" style={{ fontSize: 13, color: ledger.billedNow === 0 ? DIM : INK, textAlign: 'right', fontWeight: 600 }}>
                {ledger.optIn ? '0 until opt-ins' : ledger.billedNow.toLocaleString('en-NG')}
              </span>

              <span style={{ fontSize: 13, color: META }}>Added to gross potential</span>
              <span className="m-num" style={{ fontSize: 13, color: ledger.grossAdded === 0 ? DIM : INK, textAlign: 'right', fontWeight: 700 }}>
                {ledger.optIn ? '—' : naira(ledger.grossAdded)}
              </span>

              <span style={{ fontSize: 13, color: META }}>Invoices already sent</span>
              <span className="m-num" style={{ fontSize: 13, color: issuedInvoiceCount === 0 ? DIM : OCHRE, textAlign: 'right', fontWeight: 600 }}>
                {issuedInvoiceCount.toLocaleString('en-NG')}
              </span>
            </div>
            <p className="text-[12px]" style={{ color: HINT, marginTop: 12, lineHeight: 1.5 }}>
              Adding a fee does not change an invoice a parent is already holding. You choose when to re-issue, from Fees → Cycles.
            </p>
          </div>

          {!isEdit && !isRequired && (
            <div style={{ paddingLeft: 12, borderLeft: `2px solid ${OCHRE}`, marginBottom: 18 }}>
              <p className="text-[12px]" style={{ color: OCHRE }}>
                After creating, select the fee and choose <strong>Manage opt-ins</strong> to enrol students.
              </p>
            </div>
          )}

          {error && (
            <div style={{ paddingLeft: 12, borderLeft: `2px solid var(--color-signal)`, marginBottom: 18 }}>
              <p className="text-[13px]" style={{ color: 'var(--color-signal-text)' }}>{error}</p>
            </div>
          )}

          {/* Footer — scrolls with the content, like AddStudentModal / the canvas */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleSubmit} disabled={loading} className="m-btn m-btn-primary" style={{ flex: 1 }}>
              {loading ? 'Saving...' : isEdit ? 'Save changes' : 'Add fee'}
            </button>
            <button onClick={onClose} disabled={loading} className="m-btn m-btn-outline">
              Cancel
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
