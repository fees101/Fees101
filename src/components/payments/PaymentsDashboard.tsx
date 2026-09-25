'use client'

import { useMemo, useState } from 'react'
import type { AnalyticsBundle } from '@/lib/queries/analytics'
import {
  summarize, aggFees, aggDiscounts, aggClasses, feeChoices, feePriceFan, type Summary,
} from '@/lib/analytics/aggregate'
import DrilldownModal from './DrilldownModal'
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'

// ---------------------------------------------------------------------------
// Collections (App Shell "Money · mode 1", INK GROUND). The instrument surface
// for money and analytics: a dark full-bleed panel where collected reads in
// lifted ledger green and outstanding in lifted amber. A range/compare filter
// bar drives a five-figure strip and three sub-tabs — Position (the two charts),
// Breakdown (fee / class / discount tables) and Forecast & chasing (planned).
// All scoping, comparison and drill-down logic is preserved; only the surface
// is rebuilt off recharts onto flat inline SVG/CSS charts that read on ink.
// ---------------------------------------------------------------------------

// On-ink palette (paper-ground --color-ledger / --color-ochre are too dark to
// read on ink), matched to the invoice ledger rebuild.
const INK = {
  paper: '#f3f2f2',
  dim: '#9b9797',
  faint: '#d7d3d3',
  rule: '#605d5d',
  ruleSoft: '#444141',
  panel: '#2d2b2b',
  green: '#35c483', // --color-ledger-on-ink
  amber: '#f0a13c', // ochre lifted for the ink ground
  white: '#ffffff',
}

// Fee-price lines: neutral + ochre only — never ledger green, which is reserved
// for money that arrived (a fee's price is not collection).
const LINE_INK = ['#f3f2f2', '#9b9797', '#f0a13c', '#d7d3d3', '#b9a58f', '#8fa9b8', '#c78b6b']

const MASKED = '••••'

type PresetKey = 'term' | 'session' | '12mo' | 'all'
type SubTab = 'position' | 'breakdown' | 'forecast'
interface OverlaySeries { label: string; collected: (number | null)[]; billed: (number | null)[] }

const CATEGORY_LABELS: Record<string, string> = {
  sibling_discount: 'Sibling', bursary: 'Bursary', staff_child: 'Staff child',
  financial_hardship: 'Hardship', scholarship: 'Scholarship', fee_waiver: 'Fee waiver', other: 'Other',
}

function formatNaira(a: number): string {
  return '₦' + Math.round(a).toLocaleString('en-NG')
}

// Compact figure for the metric strip only (₦6.54m / ₦640k). Everything else
// keeps full figures so no column loses precision.
function abbrevNaira(a: number): string {
  const v = Math.round(a)
  if (Math.abs(v) >= 1e6) return '₦' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm'
  if (Math.abs(v) >= 1e3) return '₦' + Math.round(v / 1e3).toLocaleString('en-NG') + 'k'
  return '₦' + v.toLocaleString('en-NG')
}

const RANGE_CHIPS: { key: PresetKey; label: string }[] = [
  { key: 'term', label: 'This term' },
  { key: 'session', label: 'This session' },
  { key: '12mo', label: 'Last 12 months' },
  { key: 'all', label: 'All terms' },
]

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'position', label: 'Position' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'forecast', label: 'Forecast & chasing' },
]

export default function PaymentsDashboard({ bundle, showFinancials, schoolId }: { bundle: AnalyticsBundle; showFinancials: boolean; schoolId: string }) {
  useRealtimeRefresh(
    schoolId
      ? [
          { table: 'payments', filter: `school_id=eq.${schoolId}` },
          { table: 'invoices', filter: `school_id=eq.${schoolId}` },
        ]
      : []
  )
  const { termSeries: terms, feeSeries, discountSeries, classSeries, feeClassSeries } = bundle
  const len = terms.length
  const amt = (v: number) => showFinancials ? formatNaira(v) : MASKED

  // ---- Static structure derived once --------------------------------------
  const { sessions, ordinalOf, sessionCycleIds } = useMemo(() => {
    const sessions: { id: string; name: string }[] = []
    const seenSess = new Set<string>()
    const ordinalOf = new Map<string, number>()
    const perSess = new Map<string, number>()
    const sessionCycleIds = new Map<string, string[]>()
    for (const t of terms) {
      const sid = t.sessionId || '—'
      if (t.sessionId && !seenSess.has(sid)) { seenSess.add(sid); sessions.push({ id: sid, name: t.sessionName || 'Session' }) }
      const next = (perSess.get(sid) || 0) + 1
      perSess.set(sid, next)
      ordinalOf.set(t.cycleId, next)
      const arr = sessionCycleIds.get(sid) || []
      arr.push(t.cycleId)
      sessionCycleIds.set(sid, arr)
    }
    return { sessions, ordinalOf, sessionCycleIds }
  }, [terms])

  const computePreset = useMemo(() => (key: PresetKey): [number, number] => {
    if (len === 0) return [0, 0]
    if (key === 'all') return [0, len - 1]
    const activeIdx = (() => { const i = terms.findIndex(t => t.status === 'active'); return i === -1 ? len - 1 : i })()
    if (key === 'term') return [activeIdx, activeIdx]
    if (key === 'session') {
      const sid = terms[activeIdx].sessionId || '—'
      const idxs = terms.map((t, i) => (t.sessionId || '—') === sid ? i : -1).filter(i => i >= 0)
      return [idxs[0], idxs[idxs.length - 1]]
    }
    // '12mo' — cycles whose start date is within a year of the latest.
    const last = new Date(terms[len - 1].startDate)
    const cutoff = new Date(last); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1)
    const start = terms.findIndex(t => new Date(t.startDate) >= cutoff)
    return [start === -1 ? 0 : start, len - 1]
  }, [terms, len])

  // ---- Interaction state --------------------------------------------------
  const [mode, setMode] = useState<'range' | 'compare'>('range')
  const [subTab, setSubTab] = useState<SubTab>('position')
  const [range, setRange] = useState<[number, number]>(() => computePreset('term'))
  const [preset, setPreset] = useState<PresetKey | null>('term')
  const [compareType, setCompareType] = useState<'term' | 'session'>('term')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [overlayMetric, setOverlayMetric] = useState<'collected' | 'billed'>('collected')
  const [feePick, setFeePick] = useState<string>('')
  const [drilldown, setDrilldown] = useState<{ mode: 'class' | 'fee'; label: string } | null>(null)

  const [start, end] = range
  const lo = Math.min(start, end), hi = Math.max(start, end)
  const selCycleIds = useMemo(() => new Set(terms.slice(lo, hi + 1).map(t => t.cycleId)), [terms, lo, hi])

  // ---- Range-mode aggregates ---------------------------------------------
  const summary = useMemo(() => summarize(terms, selCycleIds), [terms, selCycleIds])
  const byFee = useMemo(() => aggFees(feeSeries, selCycleIds, summary.invoiceCount), [feeSeries, selCycleIds, summary.invoiceCount])
  const discounts = useMemo(() => aggDiscounts(discountSeries, selCycleIds), [discountSeries, selCycleIds])
  const classes = useMemo(() => aggClasses(classSeries, selCycleIds), [classSeries, selCycleIds])
  // Worst rate first — the table exists to find the class that needs a call.
  const classesWorst = useMemo(() => [...classes].sort((a, b) => a.rate - b.rate), [classes])

  // Fee-price fan — the picked fee's price per class over the selected terms.
  const priceChoices = useMemo(() => feeChoices(feeClassSeries, selCycleIds), [feeClassSeries, selCycleIds])
  const activeFee = priceChoices.some(c => c.name === feePick) ? feePick : (priceChoices[0]?.name || '')
  const priceFan = useMemo(() => feePriceFan(feeClassSeries, selCycleIds, activeFee), [feeClassSeries, selCycleIds, activeFee])

  // Smart baseline for the strip delta — only when the selection is exactly one
  // term (→ same term last year) or exactly one whole session (→ prior session).
  const baseline: { label: string; summary: Summary } | null = useMemo(() => {
    if (lo === hi) {
      const term = terms[lo]
      const sIdx = sessions.findIndex(s => s.id === term.sessionId)
      if (sIdx > 0) {
        const prevIds = sessionCycleIds.get(sessions[sIdx - 1].id) || []
        const ord = ordinalOf.get(term.cycleId)
        const cmp = prevIds.find(id => ordinalOf.get(id) === ord) || prevIds[prevIds.length - 1]
        if (cmp) {
          const cmpTerm = terms.find(t => t.cycleId === cmp)!
          return { label: cmpTerm.cycleName, summary: summarize(terms, new Set([cmp])) }
        }
      }
      return null
    }
    for (const s of sessions) {
      const ids = sessionCycleIds.get(s.id) || []
      if (ids.length === selCycleIds.size && ids.every(id => selCycleIds.has(id))) {
        const sIdx = sessions.findIndex(x => x.id === s.id)
        if (sIdx > 0) {
          const prevIds = sessionCycleIds.get(sessions[sIdx - 1].id) || []
          return { label: sessions[sIdx - 1].name, summary: summarize(terms, new Set(prevIds)) }
        }
      }
    }
    return null
  }, [terms, sessions, sessionCycleIds, ordinalOf, lo, hi, selCycleIds])

  const rangeLabel = useMemo(() => {
    if (lo === 0 && hi === len - 1) return 'All time'
    if (lo === hi) return terms[lo].cycleName
    for (const s of sessions) {
      const ids = sessionCycleIds.get(s.id) || []
      if (ids.length === selCycleIds.size && ids.every(id => selCycleIds.has(id))) return s.name
    }
    return `${terms[lo].cycleName} → ${terms[hi].cycleName}`
  }, [terms, sessions, sessionCycleIds, selCycleIds, lo, hi, len])

  // ---- Compare-mode aggregates -------------------------------------------
  const compareRows = useMemo(() => compareIds.map(id => {
    const ids = compareType === 'term' ? new Set([id]) : new Set(sessionCycleIds.get(id) || [])
    const label = compareType === 'term'
      ? (terms.find(t => t.cycleId === id)?.cycleName || 'Term')
      : (sessions.find(s => s.id === id)?.name || 'Session')
    const s = summarize(terms, ids)
    return { id, label, billed: s.billed, collected: s.collected, outstanding: s.outstanding, discountTotal: s.discountTotal, rate: s.collectionRate }
  }), [compareIds, compareType, terms, sessions, sessionCycleIds])

  function toggleCompare(id: string) {
    setCompareIds(cur => cur.includes(id) ? cur.filter(x => x !== id) : (cur.length >= 5 ? cur : [...cur, id]))
  }

  // Overlay lines — one per year (session), plotted against term position so
  // years line up. Same shape the old CompareOverlay drew, now inline SVG.
  const termById = useMemo(() => new Map(terms.map(t => [t.cycleId, t])), [terms])
  const { overlayAxis, overlaySeries } = useMemo(() => {
    type Entry = { sessionId: string; sessionName: string; ord: number; cycleId: string }
    const entries: Entry[] = []
    if (compareType === 'session') {
      for (const id of compareIds) {
        const name = sessions.find(s => s.id === id)?.name || 'Session'
        for (const cid of (sessionCycleIds.get(id) || [])) entries.push({ sessionId: id, sessionName: name, ord: ordinalOf.get(cid) || 1, cycleId: cid })
      }
    } else {
      for (const cid of compareIds) {
        const t = termById.get(cid)
        if (!t) continue
        entries.push({ sessionId: t.sessionId || '—', sessionName: t.sessionName || 'Session', ord: ordinalOf.get(cid) || 1, cycleId: cid })
      }
    }
    const empty = { overlayAxis: [] as string[], overlaySeries: [] as OverlaySeries[] }
    if (entries.length === 0) return empty
    const order = sessions.map(s => s.id).filter(id => entries.some(e => e.sessionId === id))
    entries.forEach(e => { if (!order.includes(e.sessionId)) order.push(e.sessionId) })
    const positions = Array.from(new Set(entries.map(e => e.ord))).sort((a, b) => a - b)
    const at = (sid: string, ord: number) => {
      const e = entries.find(en => en.sessionId === sid && en.ord === ord)
      return e ? termById.get(e.cycleId) : undefined
    }
    if (positions.length === 1 && order.length >= 2) {
      const ord = positions[0]
      const axis = order.map(sid => entries.find(e => e.sessionId === sid)!.sessionName)
      return { overlayAxis: axis, overlaySeries: [{ label: `Term ${ord}`, collected: order.map(sid => at(sid, ord)?.collected ?? null), billed: order.map(sid => at(sid, ord)?.billed ?? null) }] }
    }
    const maxOrd = positions[positions.length - 1]
    const axis = Array.from({ length: maxOrd }, (_, i) => `Term ${i + 1}`)
    const series: OverlaySeries[] = order.map(sid => ({
      label: entries.find(e => e.sessionId === sid)!.sessionName,
      collected: Array.from({ length: maxOrd }, (_, i) => at(sid, i + 1)?.collected ?? null),
      billed: Array.from({ length: maxOrd }, (_, i) => at(sid, i + 1)?.billed ?? null),
    }))
    return { overlayAxis: axis, overlaySeries: series }
  }, [compareType, compareIds, sessions, sessionCycleIds, ordinalOf, termById])

  const overlayMeaningful = overlaySeries.some(s => s.collected.filter(v => v !== null).length >= 2)

  // ---- Derived strip figures ---------------------------------------------
  const discPct = summary.grossPotential > 0 ? Math.round((summary.discountTotal / summary.grossPotential) * 1000) / 10 : 0
  const avgInvoice = summary.invoiceCount > 0 ? summary.billed / summary.invoiceCount : 0
  const ratePts = baseline ? summary.collectionRate - baseline.summary.collectionRate : null

  // Whole-history bars for "Billed against collected" — max billed sets the scale.
  const maxBilled = useMemo(() => Math.max(1, ...terms.map(t => t.billed)), [terms])

  // ---- Ink controls -------------------------------------------------------
  function chip(label: string, active: boolean, onClick: () => void, key?: string) {
    return (
      <button
        key={key || label}
        onClick={onClick}
        style={{
          background: active ? INK.paper : 'transparent',
          color: active ? '#201e1d' : INK.dim,
          border: `2px solid ${active ? INK.paper : INK.ruleSoft}`,
          padding: '6px 12px', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
          whiteSpace: 'nowrap', cursor: 'pointer',
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <>
      {/* Full-bleed ink ground, its own interior padding (App Shell "REWORK · INK"). */}
      <div style={{ background: 'var(--color-ink)', color: INK.paper }} className="px-5 sm:px-7 py-7 m-anim-fade">

      {/* Filter bar: RANGE presets, then COMPARE terms/sessions. */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-[11px] tracking-[0.14em] mr-1.5" style={{ color: INK.dim }}>RANGE</span>
        {RANGE_CHIPS.map(c => chip(c.label, mode === 'range' && preset === c.key, () => {
          setRange(computePreset(c.key)); setPreset(c.key); setMode('range')
        }, c.key))}
        <span style={{ width: 2, height: 22, background: INK.ruleSoft, margin: '0 6px' }} />
        <span className="text-[11px] tracking-[0.14em]" style={{ color: INK.dim }}>COMPARE</span>
        {chip('Terms', mode === 'compare' && compareType === 'term', () => { setMode('compare'); if (compareType !== 'term') { setCompareType('term'); setCompareIds([]) } }, 'cmp-term')}
        {chip('Sessions', mode === 'compare' && compareType === 'session', () => { setMode('compare'); if (compareType !== 'session') { setCompareType('session'); setCompareIds([]) } }, 'cmp-sess')}
        {mode === 'compare' && (
          <span className="m-num text-[12px]" style={{ color: INK.dim }}>{compareIds.length} / 5 picked</span>
        )}
        {mode === 'range' && (
          <span className="text-[12px] ml-auto" style={{ color: INK.dim }}>Showing {rangeLabel}{baseline ? ` · vs ${baseline.label}` : ''}</span>
        )}
      </div>

      {mode === 'range' ? (
        <>
          {/* Five-figure strip */}
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(5, minmax(150px, 1fr))', minWidth: 820, borderTop: `2px solid ${INK.paper}`, borderBottom: `2px solid ${INK.rule}`, marginBottom: 28 }}
          >
            <MetricCell first label="COLLECTED" value={showFinancials ? abbrevNaira(summary.collected) : MASKED} color={INK.green} sub={showFinancials ? formatNaira(summary.collected) : ''} />
            <MetricCell label="OUTSTANDING" value={showFinancials ? abbrevNaira(summary.outstanding) : MASKED} color={INK.amber} sub={showFinancials ? formatNaira(summary.outstanding) : `${100 - summary.collectionRate}% of billed`} />
            <MetricCell label="RATE" value={`${summary.collectionRate}%`} color={INK.white}
              sub={ratePts !== null ? `${ratePts >= 0 ? '+' : ''}${ratePts} pts vs ${baseline!.label}` : (showFinancials ? `of ${abbrevNaira(summary.billed)} billed` : 'of billed')}
              subColor={ratePts !== null ? (ratePts >= 0 ? INK.green : INK.amber) : INK.dim} />
            <MetricCell label="DISCOUNTED" value={showFinancials ? abbrevNaira(summary.discountTotal) : MASKED} color={INK.white} sub={`${discPct}% of gross potential`} />
            <MetricCell last label="INVOICES" value={`${summary.invoiceCount.toLocaleString()}`} color={INK.white} sub={showFinancials ? `${formatNaira(avgInvoice)} average` : 'invoices billed'} />
          </div>

          {/* Sub-tabs */}
          <div className="flex flex-wrap mb-7" style={{ borderBottom: `2px solid ${INK.rule}` }}>
            {SUB_TABS.map(t => {
              const on = subTab === t.key
              return (
                <button key={t.key} onClick={() => setSubTab(t.key)}
                  style={{ background: on ? INK.paper : 'transparent', color: on ? '#201e1d' : INK.dim, border: 0, borderBottom: `3px solid ${on ? INK.paper : 'transparent'}`, padding: '11px 18px', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer', marginBottom: -2 }}>
                  {t.label}
                </button>
              )
            })}
          </div>

          {subTab === 'position' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 40, marginBottom: 12 }}>
              {/* Billed against collected */}
              <div>
                <h2 className="text-[20px] font-extrabold mb-1" style={{ color: INK.white }}>Billed against collected</h2>
                <p className="text-[13px] mb-5" style={{ color: INK.dim }}>The full bar is billed, the green fill is collected, and the figure above each bar is its rate. Click a term to focus the whole page on it. No gridlines — the baseline and the labels are the scale.</p>
                {len === 0 ? <p className="text-[13px]" style={{ color: INK.dim }}>No terms yet.</p> : (
                  <div style={{ overflowX: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 200, borderBottom: `2px solid ${INK.rule}`, minWidth: Math.max(380, terms.length * 60) }}>
                      {terms.map((t, i) => {
                        const rate = t.billed > 0 ? Math.round((t.collected / t.billed) * 100) : 0
                        const billedH = Math.round((t.billed / maxBilled) * 100)
                        const selected = i >= lo && i <= hi
                        return (
                          <button key={t.cycleId} onClick={() => { setRange([i, i]); setPreset(null) }}
                            title={`${t.cycleName} — ${showFinancials ? formatNaira(t.collected) + ' of ' + formatNaira(t.billed) : rate + '% collected'}`}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', minWidth: 0, background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}>
                            <p className="m-num" style={{ fontSize: 11, margin: '0 0 6px', color: selected ? INK.white : INK.faint, textAlign: 'center', fontWeight: selected ? 700 : 400 }}>{rate}%</p>
                            <div style={{ position: 'relative', background: INK.panel, borderTop: `1px solid ${selected ? INK.paper : INK.rule}`, height: `${Math.max(2, billedH)}%` }}>
                              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: INK.green, opacity: selected ? 1 : 0.82, height: `${rate}%` }} />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 14, minWidth: Math.max(380, terms.length * 60) }}>
                      {terms.map((t, i) => {
                        const selected = i >= lo && i <= hi
                        return (
                          <div key={t.cycleId} style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
                            <p style={{ fontSize: 11, margin: 0, color: selected ? INK.paper : INK.faint, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.cycleName}</p>
                            <p className="m-num" style={{ fontSize: 11, margin: '2px 0 0', color: INK.dim, textAlign: 'center' }}>{t.sessionName || ''}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Fee price by class, over time */}
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
                  <h2 className="text-[20px] font-extrabold" style={{ color: INK.white }}>Fee price by class, over time</h2>
                  {priceChoices.length > 0 && (
                    <select value={activeFee} onChange={e => setFeePick(e.target.value)}
                      style={{ background: 'transparent', color: INK.paper, border: `2px solid ${INK.rule}`, padding: '5px 8px', fontSize: 12, minHeight: 32 }}>
                      {priceChoices.map(c => <option key={c.name} value={c.name} style={{ color: '#000' }}>{c.name}</option>)}
                    </select>
                  )}
                </div>
                <p className="text-[13px] mb-5" style={{ color: INK.dim }}>One line per class — watch a fee climb and see how far the classes have spread apart.</p>
                {priceFan.points.length === 0 ? (
                  <p className="text-[13px]" style={{ color: INK.dim }}>No fee-price history in this selection.</p>
                ) : (
                  <div style={{ minWidth: 380 }}>
                    <InkLineChart
                      axisLen={priceFan.points.length}
                      lines={priceFan.classes.map((cl, i) => ({ label: cl, color: LINE_INK[i % LINE_INK.length], values: priceFan.points.map(p => p.prices[cl]) }))}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, paddingTop: 14, borderTop: `1px solid ${INK.ruleSoft}`, marginTop: 8 }}>
                      {priceFan.classes.map((cl, i) => {
                        const latest = [...priceFan.points].reverse().map(p => p.prices[cl]).find(v => v !== null) ?? null
                        return (
                          <span key={cl} className="text-[12px]" style={{ color: INK.faint }}>
                            <span style={{ display: 'inline-block', width: 14, height: 2, background: LINE_INK[i % LINE_INK.length], verticalAlign: 'middle', marginRight: 6 }} />
                            {cl}{latest !== null ? <> · <span className="m-num">{showFinancials ? formatNaira(latest) : MASKED}</span></> : ''}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {subTab === 'breakdown' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 40 }}>
                {/* Fee performance */}
                <div>
                  <h2 className="text-[20px] font-extrabold mb-1" style={{ color: INK.white }}>Fee performance</h2>
                  <p className="text-[13px] mb-4" style={{ color: INK.dim }}>Required fees and opt-ins, most billed first. Click a fee to see the students behind it.</p>
                  {byFee.length === 0 ? <p className="text-[13px]" style={{ color: INK.dim }}>No fees in this selection.</p> : (
                    <div style={{ overflowX: 'auto' }}>
                      <div className="grid" style={{ gridTemplateColumns: 'minmax(120px,1.8fr) minmax(70px,0.8fr) minmax(88px,1fr) minmax(56px,0.6fr) minmax(64px,0.7fr)', gap: 10, minWidth: 420, padding: '0 0 8px', borderBottom: `2px solid ${INK.rule}` }}>
                        <ColH>FEE</ColH><ColH>KIND</ColH><ColH right>BILLED</ColH><ColH right>RATE</ColH><ColH right>UPTAKE</ColH>
                      </div>
                      {byFee.map(f => (
                        <div key={`${f.kind}:${f.name}`} onClick={() => setDrilldown({ mode: 'fee', label: f.name })} className="grid cursor-pointer" style={{ gridTemplateColumns: 'minmax(120px,1.8fr) minmax(70px,0.8fr) minmax(88px,1fr) minmax(56px,0.6fr) minmax(64px,0.7fr)', gap: 10, minWidth: 420, padding: '11px 0', borderBottom: `1px solid ${INK.ruleSoft}` }}>
                          <span className="text-[14px] font-semibold" style={{ color: INK.paper }}>{f.name}</span>
                          <span className="text-[12px] tracking-[0.06em]" style={{ color: INK.dim }}>{f.kind === 'opt_in' ? 'OPT-IN' : 'REQUIRED'}</span>
                          <span className="m-num text-[14px] text-right" style={{ color: INK.faint }}>{amt(f.billed)}</span>
                          <span className="m-num text-[14px] text-right font-semibold" style={{ color: f.rate >= 80 ? INK.green : INK.amber }}>{f.rate}%</span>
                          <span className="m-num text-[13px] text-right" style={{ color: INK.dim }}>{f.kind === 'opt_in' ? `${f.uptake}%` : '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Where the money goes — preserves the potential/discount/collected breakdown. */}
                  <h2 className="text-[20px] font-extrabold mt-8 mb-1" style={{ color: INK.white }}>Where the money goes</h2>
                  <p className="text-[13px] mb-3 m-num" style={{ color: INK.dim }}>Of {showFinancials ? formatNaira(summary.grossPotential) : MASKED} gross potential.</p>
                  {(() => {
                    const gp = Math.max(1, summary.grossPotential)
                    const seg = (v: number) => `${Math.max(0, Math.round((v / gp) * 100))}%`
                    return (
                      <>
                        <div style={{ display: 'flex', height: 14, background: INK.panel, minWidth: 380 }}>
                          <span style={{ background: INK.green, width: seg(summary.collected) }} />
                          <span style={{ background: INK.amber, width: seg(summary.outstanding) }} />
                          <span style={{ background: INK.rule, width: seg(summary.discountTotal) }} />
                        </div>
                        <div className="flex flex-col gap-1.5" style={{ marginTop: 12 }}>
                          <MoneyLine color={INK.green} label="Actually collected" value={amt(summary.collected)} valueColor={INK.green} />
                          <MoneyLine color={INK.amber} label="Still outstanding" value={amt(summary.outstanding)} valueColor={INK.amber} />
                          <MoneyLine color={INK.rule} label="Given away as discounts" value={amt(summary.discountTotal)} valueColor={INK.faint} />
                        </div>
                      </>
                    )
                  })()}
                </div>

                {/* Class collection + discounts */}
                <div>
                  <h2 className="text-[20px] font-extrabold mb-1" style={{ color: INK.white }}>Class collection, worst first</h2>
                  <p className="text-[13px] mb-4" style={{ color: INK.dim }}>Sorted by rate, not by size — the chart exists to find the class that needs a phone call. Click for the students.</p>
                  {classesWorst.length === 0 ? <p className="text-[13px]" style={{ color: INK.dim }}>No invoices in this selection.</p> : classesWorst.map(c => (
                    <div key={c.className} onClick={() => setDrilldown({ mode: 'class', label: c.className })} className="grid items-center cursor-pointer" style={{ gridTemplateColumns: 'minmax(64px,0.7fr) minmax(120px,2fr) minmax(48px,0.5fr) minmax(96px,1fr)', gap: 12, minWidth: 420, padding: '10px 0', borderBottom: `1px solid ${INK.ruleSoft}` }}>
                      <span className="text-[13px] font-semibold" style={{ color: INK.paper }}>{c.className}</span>
                      <span style={{ display: 'flex', height: 14, background: INK.panel }}>
                        <span style={{ background: INK.green, width: `${c.rate}%` }} />
                        <span style={{ background: INK.amber, width: `${100 - c.rate}%` }} />
                      </span>
                      <span className="m-num text-[13px] text-right font-semibold" style={{ color: INK.white }}>{c.rate}%</span>
                      <span className="m-num text-[13px] text-right" style={{ color: INK.amber }}>{amt(c.outstanding)}</span>
                    </div>
                  ))}

                  <h2 className="text-[20px] font-extrabold mt-7 mb-1" style={{ color: INK.white }}>Discounts given</h2>
                  <p className="text-[13px] mb-4" style={{ color: INK.dim }}>What the school chose to forgo, by category.</p>
                  {discounts.length === 0 ? <p className="text-[13px]" style={{ color: INK.dim }}>No discounts in this selection.</p> : (
                    <>
                      <div className="grid" style={{ gridTemplateColumns: 'minmax(110px,1.6fr) minmax(56px,0.6fr) minmax(56px,0.6fr) minmax(96px,1fr)', gap: 12, minWidth: 420, padding: '0 0 8px', borderBottom: `2px solid ${INK.rule}` }}>
                        <ColH>CATEGORY</ColH><ColH right>STUDENTS</ColH><ColH right>COUNT</ColH><ColH right>MONEY CUT</ColH>
                      </div>
                      {discounts.map(d => (
                        <div key={d.category} className="grid" style={{ gridTemplateColumns: 'minmax(110px,1.6fr) minmax(56px,0.6fr) minmax(56px,0.6fr) minmax(96px,1fr)', gap: 12, minWidth: 420, padding: '10px 0', borderBottom: `1px solid ${INK.ruleSoft}` }}>
                          <span className="text-[14px] font-semibold" style={{ color: INK.paper }}>{CATEGORY_LABELS[d.category] || d.category}</span>
                          <span className="m-num text-[13px] text-right" style={{ color: INK.dim }}>{d.studentCount}</span>
                          <span className="m-num text-[13px] text-right" style={{ color: INK.dim }}>{d.discountCount}</span>
                          <span className="m-num text-[14px] text-right" style={{ color: INK.faint }}>{amt(d.estAmount)}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {subTab === 'forecast' && <ForecastPlanned />}
        </>
      ) : (
        // ---- Compare mode ----
        <>
          <ComparePicker
            items={compareType === 'term'
              ? terms.map(t => ({ id: t.cycleId, name: t.cycleName, active: t.status === 'active' }))
              : sessions.map(s => ({ id: s.id, name: s.name }))}
            selected={compareIds}
            onToggle={toggleCompare}
            onClear={() => setCompareIds([])}
            kind={compareType}
          />

          {overlayMeaningful && (
            <div style={{ marginTop: 28 }}>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
                <h2 className="text-[20px] font-extrabold" style={{ color: INK.white }}>{overlaySeries.length > 1 ? 'Years overlaid, term by term' : 'Trajectory across terms'}</h2>
                <div className="flex" style={{ border: `2px solid ${INK.rule}` }}>
                  {(['collected', 'billed'] as const).map(m => (
                    <button key={m} onClick={() => setOverlayMetric(m)}
                      style={{ background: overlayMetric === m ? INK.paper : 'transparent', color: overlayMetric === m ? '#201e1d' : INK.dim, border: 0, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>{m}</button>
                  ))}
                </div>
              </div>
              <p className="text-[13px] mb-5" style={{ color: INK.dim }}>{overlayMetric === 'collected' ? 'Collected' : 'Billed'} at each term position — years lined up together.</p>
              <div style={{ minWidth: 380 }}>
                <InkLineChart
                  axisLen={overlayAxis.length}
                  axisLabels={overlayAxis}
                  lines={overlaySeries.map((s, i) => ({ label: s.label, color: i === overlaySeries.length - 1 ? INK.green : LINE_INK[(i + 1) % LINE_INK.length], values: overlayMetric === 'collected' ? s.collected : s.billed }))}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, paddingTop: 14, borderTop: `1px solid ${INK.ruleSoft}`, marginTop: 8 }}>
                  {overlaySeries.map((s, i) => (
                    <span key={s.label} className="text-[12px]" style={{ color: INK.faint }}>
                      <span style={{ display: 'inline-block', width: 14, height: 2, background: i === overlaySeries.length - 1 ? INK.green : LINE_INK[(i + 1) % LINE_INK.length], verticalAlign: 'middle', marginRight: 6 }} />
                      {s.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Side-by-side */}
          <div style={{ marginTop: 28 }}>
            <h2 className="text-[20px] font-extrabold mb-1" style={{ color: INK.white }}>Side-by-side</h2>
            <p className="text-[13px] mb-4" style={{ color: INK.dim }}>{compareRows.length > 1 ? `Change shown vs ${compareRows[0].label}.` : `Pick up to 5 ${compareType}s above to compare.`}</p>
            {compareRows.length === 0 ? (
              <p className="text-[13px]" style={{ color: INK.dim }}>Nothing picked yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div className="grid" style={{ gridTemplateColumns: 'minmax(120px,1.6fr) repeat(4, minmax(96px,1fr)) minmax(64px,0.7fr)', gap: 12, minWidth: 640, padding: '0 0 8px', borderBottom: `2px solid ${INK.rule}` }}>
                  <ColH>PERIOD</ColH><ColH right>BILLED</ColH><ColH right>COLLECTED</ColH><ColH right>OUTSTANDING</ColH><ColH right>DISCOUNTS</ColH><ColH right>RATE</ColH>
                </div>
                {compareRows.map((r, i) => {
                  const base = compareRows[0]
                  const d = (cur: number, b: number) => (i === 0 || b === 0) ? null : Math.round(((cur - b) / b) * 100)
                  return (
                    <div key={r.id} className="grid items-baseline" style={{ gridTemplateColumns: 'minmax(120px,1.6fr) repeat(4, minmax(96px,1fr)) minmax(64px,0.7fr)', gap: 12, minWidth: 640, padding: '11px 0', borderBottom: `1px solid ${INK.ruleSoft}` }}>
                      <span className="text-[14px] font-semibold" style={{ color: INK.paper }}>{r.label}{i === 0 && compareRows.length > 1 ? <span className="text-[11px] ml-1" style={{ color: INK.dim }}>(base)</span> : ''}</span>
                      <DeltaNum value={amt(r.billed)} pct={d(r.billed, base.billed)} color={INK.faint} />
                      <DeltaNum value={amt(r.collected)} pct={d(r.collected, base.collected)} color={INK.green} />
                      <DeltaNum value={amt(r.outstanding)} pct={d(r.outstanding, base.outstanding)} color={INK.amber} invert />
                      <span className="m-num text-[14px] text-right" style={{ color: INK.faint }}>{amt(r.discountTotal)}</span>
                      <span className="m-num text-[14px] text-right font-semibold" style={{ color: INK.white }}>{r.rate}%</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {drilldown && (
        <DrilldownModal
          title={drilldown.label}
          subtitle={`Students · ${rangeLabel}`}
          cycleIds={Array.from(selCycleIds)}
          className={drilldown.mode === 'class' ? drilldown.label : undefined}
          feeName={drilldown.mode === 'fee' ? drilldown.label : undefined}
          showFinancials={showFinancials}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
    </>
  )
}

// ── Small ink sub-components ────────────────────────────────────────────────

function MetricCell({ label, value, color, sub, subColor, first, last }: { label: string; value: string; color: string; sub?: string; subColor?: string; first?: boolean; last?: boolean }) {
  return (
    <div style={{ padding: first ? '18px 20px 18px 0' : last ? '18px 0 18px 20px' : '18px 20px', borderRight: last ? undefined : `1px solid ${INK.ruleSoft}` }}>
      <p className="text-[11px] tracking-[0.14em]" style={{ color: INK.dim, margin: '0 0 8px' }}>{label}</p>
      <p className="m-num" style={{ fontSize: 34, fontWeight: 800, margin: 0, lineHeight: 0.95, color, letterSpacing: '-0.025em' }}>{value}</p>
      {sub ? <p className="m-num text-[12px]" style={{ color: subColor || INK.dim, margin: '6px 0 0' }}>{sub}</p> : null}
    </div>
  )
}

function ColH({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <span className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: INK.dim, textAlign: right ? 'right' : 'left' }}>{children}</span>
}

function MoneyLine({ color, label, value, valueColor }: { color: string; label: string; value: string; valueColor: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]" style={{ minWidth: 380 }}>
      <span className="flex items-center gap-2" style={{ color: INK.faint }}>
        <span style={{ width: 12, height: 12, background: color, display: 'inline-block' }} />{label}
      </span>
      <span className="m-num" style={{ color: valueColor }}>{value}</span>
    </div>
  )
}

function DeltaNum({ value, pct, color, invert }: { value: string; pct: number | null; color: string; invert?: boolean }) {
  let chip: React.ReactNode = null
  if (pct !== null && pct !== 0) {
    const good = invert ? pct < 0 : pct > 0
    chip = <span className="text-[11px]" style={{ color: good ? INK.green : INK.amber }}>{pct > 0 ? '▲' : '▼'}{Math.abs(pct)}%</span>
  }
  return (
    <span className="text-right">
      <span className="m-num text-[14px]" style={{ color }}>{value}</span>
      {chip ? <span className="ml-1.5">{chip}</span> : null}
    </span>
  )
}

// Flat multi-line chart on ink: no gridlines, a single 2px baseline, one
// polyline per series scaled to the shared min/max. Nulls break a line.
//
// Sized intrinsically from the point count (roughly 130px of run per point)
// rather than always stretching to fill whatever panel it sits in — with
// only 2-3 points (e.g. three terms in a session), `width: 100%` on a wide
// dashboard column turned two short line segments into an exaggerated,
// distorted-looking peak. `maxWidth: 100%` still lets it shrink on narrow
// viewports; it just no longer grows past what the data can naturally fill.
function InkLineChart({ lines, axisLen, axisLabels }: { lines: { label: string; color: string; values: (number | null)[] }[]; axisLen: number; axisLabels?: string[] }) {
  const n = Math.max(1, axisLen)
  const H = 180, top = 10, bottom = 164, left = 8
  const W = Math.max(320, Math.min(760, n * 130))
  const right = W - 8
  const all: number[] = []
  for (const ln of lines) for (const v of ln.values) if (v !== null && v !== undefined) all.push(v)
  const min = all.length ? Math.min(...all) : 0
  const max = all.length ? Math.max(...all) : 1
  const span = max - min || 1
  const x = (i: number) => n === 1 ? (left + right) / 2 : left + (i * (right - left)) / (n - 1)
  const y = (v: number) => bottom - ((v - min) / span) * (bottom - top)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, maxWidth: '100%', height: 180, display: 'block', overflow: 'visible' }}>
      <line x1={0} y1={bottom + 2} x2={W} y2={bottom + 2} stroke={INK.rule} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {lines.map(ln => {
        const pts: { i: number; v: number }[] = []
        ln.values.forEach((v, i) => { if (v !== null && v !== undefined) pts.push({ i, v }) })
        if (pts.length === 0) return null
        const poly = pts.map(p => `${x(p.i)},${y(p.v)}`).join(' ')
        return (
          <g key={ln.label}>
            {pts.length > 1 && <polyline points={poly} fill="none" stroke={ln.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {pts.map(p => <rect key={p.i} x={x(p.i) - 3} y={y(p.v) - 3} width={6} height={6} fill={ln.color} />)}
          </g>
        )
      })}
      {axisLabels && axisLabels.map((lb, i) => (
        <text key={i} x={x(i)} y={H - 2} fontSize={10} fill={INK.dim} textAnchor="middle" fontFamily="Archivo, sans-serif">{lb}</text>
      ))}
    </svg>
  )
}

// Ink multi-select for compare mode — chips, tick up to 5. Replaces the paper
// PeriodPicker (its m- fields are tuned for the paper ground).
function ComparePicker({ items, selected, onToggle, onClear, kind }: { items: { id: string; name: string; active?: boolean }[]; selected: string[]; onToggle: (id: string) => void; onClear: () => void; kind: 'term' | 'session' }) {
  const atMax = selected.length >= 5
  return (
    <div style={{ background: INK.panel, padding: 16 }}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-[13px]" style={{ color: INK.faint }}>Pick up to 5 {kind}s to compare.</p>
        {selected.length > 0 && <button onClick={onClear} className="text-[12px] font-semibold" style={{ background: 'transparent', border: 0, color: INK.amber, cursor: 'pointer' }}>Clear</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map(it => {
          const on = selected.includes(it.id)
          const disabled = !on && atMax
          return (
            <button key={it.id} onClick={() => onToggle(it.id)} disabled={disabled}
              style={{ background: on ? INK.paper : 'transparent', color: on ? '#201e1d' : disabled ? INK.rule : INK.faint, border: `2px solid ${on ? INK.paper : INK.ruleSoft}`, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              {it.name}{it.active ? ' ·' : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Forecast & chasing — planned analytics (App Shell "NOT IN THE CURRENT BUILD").
// Descriptions only, no fabricated figures: each is computable from data the
// school already holds, but is not built yet, so nothing is shown as a fact.
function ForecastPlanned() {
  const items: { title: string; body: string }[] = [
    { title: 'Collection velocity', body: 'Cumulative collection by day since invoices went out, against the same point last term — whether you are ahead or behind pace, not just position.' },
    { title: 'Term-close forecast', body: 'Where collection lands at term end if the current pace holds, and the gap that needs chasing. Shown as a range, never a single false-precision figure.' },
    { title: 'Does chasing work?', body: 'Payment rate within 7 days of a reminder, by channel and attempt — so reminders can be judged on what they recover.' },
    { title: 'Repeat debtors', body: 'Families late in three or more consecutive terms. A different problem from a one-off late payment, and it needs a plan, not a reminder.' },
    { title: 'How parents pay', body: 'Method mix and average settlement time — which rails to keep, and whether virtual accounts are worth provisioning for every student.' },
    { title: 'Two more worth building', body: 'Discount policy cost per term as a trend, and enrolment against revenue per student — each answers a question you would otherwise guess at.' },
  ]
  return (
    <div style={{ paddingTop: 4 }}>
      <p className="text-[11px] tracking-[0.16em] mb-2" style={{ color: INK.dim }}>PLANNED — NOT IN THE CURRENT BUILD</p>
      <h2 className="text-[25px] font-extrabold mb-1.5" style={{ color: INK.white }}>Five questions the product can&apos;t answer yet.</h2>
      <p className="text-[14px] mb-7" style={{ color: INK.dim, maxWidth: '76ch', lineHeight: 1.5 }}>Everything above reports what happened. These are predictive or diagnostic — they say what to do next, and each is computable from data you already hold. None is shown until it is built and real.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 32 }}>
        {items.map(it => (
          <div key={it.title} style={{ borderTop: `1px solid ${INK.ruleSoft}`, paddingTop: 14 }}>
            <h3 className="text-[16px] font-extrabold mb-1" style={{ color: INK.paper }}>{it.title}</h3>
            <p className="text-[13px]" style={{ color: INK.dim, lineHeight: 1.5 }}>{it.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
