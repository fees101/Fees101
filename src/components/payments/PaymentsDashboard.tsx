'use client'

import { useMemo, useState } from 'react'
import type { AnalyticsBundle } from '@/lib/queries/analytics'
import {
  summarize, aggFees, aggDiscounts, aggClasses, feeTrends as buildFeeTrends,
  feeChoices, feePriceFan, type Summary,
} from '@/lib/analytics/aggregate'
import { TimelineHero, CompareBars, CompareRates, CompareOverlay, FeePriceChart, type PresetKey, type OverlaySeries } from './TimelineHero'
import { PeriodPicker } from './PeriodPicker'
import {
  FeeTrendChart, PotentialBreakdown, RevenueMix, FeeCollectionBars, OptInUptake, DiscountBar,
} from './AnalyticsCharts'

function formatNaira(a: number): string {
  return '₦' + Math.round(a).toLocaleString('en-NG')
}

const CATEGORY_LABELS: Record<string, string> = {
  sibling_discount: 'Sibling', bursary: 'Bursary', staff_child: 'Staff child',
  financial_hardship: 'Hardship', scholarship: 'Scholarship', fee_waiver: 'Fee waiver', other: 'Other',
}

function RateBar({ rate }: { rate: number }) {
  const capped = Math.min(100, Math.max(0, rate))
  const color = rate >= 80 ? 'bg-mint' : rate >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums w-9 text-right">{rate}%</span>
    </div>
  )
}

function Delta({ current, previous, label, invert = false }: {
  current: number; previous: number | undefined; label?: string; invert?: boolean
}) {
  if (previous === undefined || previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return <p className="text-gray-400 text-xs mt-2">no change vs {label}</p>
  const good = invert ? pct < 0 : pct > 0
  const arrow = pct > 0 ? '▲' : '▼'
  return (
    <p className={`text-xs mt-2 ${good ? 'text-mint' : 'text-red-400'}`}>
      {arrow} {Math.abs(pct)}% <span className="text-gray-400">vs {label}</span>
    </p>
  )
}

function Tile({ label, value, sub, tone = 'navy', delta }: {
  label: string; value: string; sub?: string; tone?: 'navy' | 'mint' | 'amber' | 'gray'; delta?: React.ReactNode
}) {
  const toneClass = { navy: 'text-navy', mint: 'text-mint', amber: 'text-amber-500', gray: 'text-gray-500' }[tone]
  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200">
      <p className="text-gray-500 text-sm mb-1">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      {delta ?? (sub && <p className="text-gray-500 text-xs mt-2">{sub}</p>)}
    </div>
  )
}

// Lightweight divider heading that groups the stack of cards into sections.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 pt-2">{children}</h2>
  )
}

function FeeTable({ rows }: { rows: { name: string; studentsBilled: number; billed: number; collected: number; outstanding: number; rate: number }[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-100">
          <th className="px-6 py-3 font-semibold">Fee</th>
          <th className="px-6 py-3 font-semibold text-right">Students</th>
          <th className="px-6 py-3 font-semibold text-right">Billed</th>
          <th className="px-6 py-3 font-semibold text-right">Collected (est.)</th>
          <th className="px-6 py-3 font-semibold text-right">Outstanding</th>
          <th className="px-6 py-3 font-semibold">Rate</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map(r => (
          <tr key={r.name} className="hover:bg-gray-50/50">
            <td className="px-6 py-3 font-medium text-navy">{r.name}</td>
            <td className="px-6 py-3 text-right tabular-nums text-gray-600">{r.studentsBilled}</td>
            <td className="px-6 py-3 text-right tabular-nums text-gray-600">{formatNaira(r.billed)}</td>
            <td className="px-6 py-3 text-right tabular-nums text-mint font-medium">{formatNaira(r.collected)}</td>
            <td className="px-6 py-3 text-right tabular-nums text-amber-600">{formatNaira(r.outstanding)}</td>
            <td className="px-6 py-3"><RateBar rate={r.rate} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function PaymentsDashboard({ bundle }: { bundle: AnalyticsBundle }) {
  const { termSeries: terms, feeSeries, discountSeries, classSeries, feeClassSeries } = bundle
  const len = terms.length

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

  const termItems = terms.map(t => ({ id: t.cycleId, name: t.cycleName, status: t.status }))
  const sessionItems = sessions.map(s => ({ id: s.id, name: s.name }))

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
  const [range, setRange] = useState<[number, number]>(() => computePreset('term'))
  const [preset, setPreset] = useState<PresetKey | null>('term')
  // Bumped on every preset click so the zoom brush remounts and re-reads the
  // window — recharts' Brush otherwise ignores unchanged startIndex/endIndex
  // props (clicking the same preset twice would leave the brush stuck open).
  const [brushNonce, setBrushNonce] = useState(0)
  const [compareType, setCompareType] = useState<'term' | 'session'>('term')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [overlayMetric, setOverlayMetric] = useState<'collected' | 'billed' | 'both'>('collected')
  const [feePick, setFeePick] = useState<string>('')

  const [start, end] = range
  const lo = Math.min(start, end), hi = Math.max(start, end)

  const selCycleIds = useMemo(() => new Set(terms.slice(lo, hi + 1).map(t => t.cycleId)), [terms, lo, hi])

  // ---- Range-mode aggregates ---------------------------------------------
  const summary = useMemo(() => summarize(terms, selCycleIds), [terms, selCycleIds])
  const byFee = useMemo(() => aggFees(feeSeries, selCycleIds, summary.invoiceCount), [feeSeries, selCycleIds, summary.invoiceCount])
  const discounts = useMemo(() => aggDiscounts(discountSeries, selCycleIds), [discountSeries, selCycleIds])
  const classes = useMemo(() => aggClasses(classSeries, selCycleIds), [classSeries, selCycleIds])
  const trends = useMemo(() => buildFeeTrends(feeSeries, selCycleIds), [feeSeries, selCycleIds])
  const optIns = byFee.filter(f => f.kind === 'opt_in')
  const required = byFee.filter(f => f.kind === 'required')

  // Fee-price fan — the picked fee's price per class over the selected terms.
  const priceChoices = useMemo(() => feeChoices(feeClassSeries, selCycleIds), [feeClassSeries, selCycleIds])
  const activeFee = priceChoices.some(c => c.name === feePick) ? feePick : (priceChoices[0]?.name || '')
  const priceFan = useMemo(() => feePriceFan(feeClassSeries, selCycleIds, activeFee), [feeClassSeries, selCycleIds, activeFee])

  // Smart baseline for the KPI deltas — only when the selection is exactly one
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
    // Whole-session selection?
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

  const prev = baseline?.summary

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

  // Overlay line data — always one line per YEAR (session), plotted against term
  // position (1st/2nd/3rd term) so years line up on top of each other. Picking
  // whole sessions draws each session's full run; picking individual terms
  // groups them by their year, so terms from different years become separate
  // lines rather than one line snaking left-to-right.
  const termById = useMemo(() => new Map(terms.map(t => [t.cycleId, t])), [terms])

  const { overlayAxis, overlaySeries, overlayHeading, overlayContext } = useMemo(() => {
    type Entry = { sessionId: string; sessionName: string; ord: number; cycleId: string }
    const entries: Entry[] = []
    if (compareType === 'session') {
      for (const id of compareIds) {
        const name = sessions.find(s => s.id === id)?.name || 'Session'
        for (const cid of (sessionCycleIds.get(id) || [])) {
          entries.push({ sessionId: id, sessionName: name, ord: ordinalOf.get(cid) || 1, cycleId: cid })
        }
      }
    } else {
      for (const cid of compareIds) {
        const t = termById.get(cid)
        if (!t) continue
        entries.push({ sessionId: t.sessionId || '—', sessionName: t.sessionName || 'Session', ord: ordinalOf.get(cid) || 1, cycleId: cid })
      }
    }
    const empty = { overlayAxis: [] as string[], overlaySeries: [] as OverlaySeries[], overlayHeading: '', overlayContext: '' }
    if (entries.length === 0) return empty

    // Distinct years (chronological) and distinct term positions among the picks.
    const order = sessions.map(s => s.id).filter(id => entries.some(e => e.sessionId === id))
    entries.forEach(e => { if (!order.includes(e.sessionId)) order.push(e.sessionId) })
    const positions = Array.from(new Set(entries.map(e => e.ord))).sort((a, b) => a - b)

    const at = (sid: string, ord: number) => {
      const e = entries.find(en => en.sessionId === sid && en.ord === ord)
      return e ? termById.get(e.cycleId) : undefined
    }

    // Same term position across several years (e.g. all 2nd terms) → x-axis =
    // years, a single trend line so you actually see the year-over-year shape.
    if (positions.length === 1 && order.length >= 2) {
      const ord = positions[0]
      const axis = order.map(sid => entries.find(e => e.sessionId === sid)!.sessionName)
      const series: OverlaySeries[] = [{
        label: `Term ${ord}`,
        collected: order.map(sid => at(sid, ord)?.collected ?? null),
        billed: order.map(sid => at(sid, ord)?.billed ?? null),
      }]
      return { overlayAxis: axis, overlaySeries: series, overlayHeading: `Term ${ord} across years`, overlayContext: 'for the same term, year over year' }
    }

    // Otherwise x-axis = term position, one line per year (years overlaid).
    const maxOrd = positions[positions.length - 1]
    const axis = Array.from({ length: maxOrd }, (_, i) => `Term ${i + 1}`)
    const series: OverlaySeries[] = order.map(sid => ({
      label: entries.find(e => e.sessionId === sid)!.sessionName,
      collected: Array.from({ length: maxOrd }, (_, i) => at(sid, i + 1)?.collected ?? null),
      billed: Array.from({ length: maxOrd }, (_, i) => at(sid, i + 1)?.billed ?? null),
    }))
    return {
      overlayAxis: axis, overlaySeries: series,
      overlayHeading: order.length > 1 ? 'Years overlaid, term by term' : 'Trajectory across terms',
      overlayContext: 'at each term position — years lined up together',
    }
  }, [compareType, compareIds, sessions, sessionCycleIds, ordinalOf, termById])

  // Only worth showing when at least one line connects 2+ points.
  const overlayMeaningful = overlaySeries.some(s => s.collected.filter(v => v !== null).length >= 2)

  const modeBtn = (m: 'range' | 'compare', label: string) => (
    <button onClick={() => setMode(m)}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === m ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'}`}>
      {label}
    </button>
  )

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy">Payments</h1>
          <p className="text-gray-500 mt-1">
            {mode === 'range'
              ? <>Showing <span className="font-medium text-navy">{rangeLabel}</span>{baseline && <> · vs {baseline.label}</>}</>
              : <>Comparing {compareIds.length} {compareType}{compareIds.length === 1 ? '' : 's'}</>}
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 p-0.5">
          {modeBtn('range', 'Explore')}
          {modeBtn('compare', 'Compare')}
        </div>
      </header>

      {mode === 'range' ? (
        <>
          <TimelineHero
            terms={terms}
            startIndex={lo}
            endIndex={hi}
            brushNonce={brushNonce}
            onBrush={(s, e) => { if (s === lo && e === hi) return; setRange([s, e]); setPreset(null) }}
            preset={preset}
            onPreset={k => { setRange(computePreset(k)); setPreset(k); setBrushNonce(n => n + 1) }}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Tile label="Billed" value={formatNaira(summary.billed)} sub={`${summary.invoiceCount} invoices`}
              delta={<Delta current={summary.billed} previous={prev?.billed} label={baseline?.label} />} />
            <Tile label="Collected" value={formatNaira(summary.collected)} tone="mint" sub={`${summary.collectionRate}% of billed`}
              delta={<Delta current={summary.collected} previous={prev?.collected} label={baseline?.label} />} />
            <Tile label="Outstanding" value={formatNaira(summary.outstanding)} tone="amber" sub="Still owed"
              delta={<Delta current={summary.outstanding} previous={prev?.outstanding} label={baseline?.label} invert />} />
            <Tile label="Discounts given" value={formatNaira(summary.discountTotal)} sub={`of ${formatNaira(summary.grossPotential)} potential`}
              delta={<Delta current={summary.discountTotal} previous={prev?.discountTotal} label={baseline?.label} invert />} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PotentialBreakdown
              grossPotential={summary.grossPotential} discountTotal={summary.discountTotal}
              billed={summary.billed} outstanding={summary.outstanding} collected={summary.collected} />
            <RevenueMix fees={byFee} />
          </div>

          <SectionLabel>By fee</SectionLabel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FeeCollectionBars fees={byFee} />
            <OptInUptake fees={optIns} />
          </div>

          <FeeTrendChart fees={trends} />

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-navy">Revenue by optional fee (opt-ins)</h2>
              <p className="text-xs text-gray-500 mt-0.5">collected is estimated by how far each invoice is paid</p>
            </div>
            {optIns.length === 0 ? <p className="px-6 py-8 text-sm text-gray-500">No optional fees in this selection.</p> : <FeeTable rows={optIns} />}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100"><h2 className="font-bold text-navy">Revenue by required fee</h2></div>
            {required.length === 0 ? <p className="px-6 py-8 text-sm text-gray-500">No required fees in this selection.</p> : <FeeTable rows={required} />}
          </div>

          <FeePriceChart choices={priceChoices} fan={priceFan} selected={activeFee} onSelect={setFeePick} />

          <SectionLabel>By class</SectionLabel>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100"><h2 className="font-bold text-navy">Collection by class</h2></div>
            {classes.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-500">No invoices in this selection.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="px-6 py-3 font-semibold">Class</th>
                    <th className="px-6 py-3 font-semibold text-right">Students</th>
                    <th className="px-6 py-3 font-semibold text-right">Billed</th>
                    <th className="px-6 py-3 font-semibold text-right">Collected</th>
                    <th className="px-6 py-3 font-semibold text-right">Outstanding</th>
                    <th className="px-6 py-3 font-semibold">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {classes.map(r => (
                    <tr key={r.className} className="hover:bg-gray-50/50">
                      <td className="px-6 py-3 font-medium text-navy">{r.className}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-gray-600">{r.studentsBilled}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-gray-600">{formatNaira(r.billed)}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-mint font-medium">{formatNaira(r.collected)}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-amber-600">{formatNaira(r.outstanding)}</td>
                      <td className="px-6 py-3"><RateBar rate={r.rate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <SectionLabel>Discounts</SectionLabel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DiscountBar rows={discounts} />
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100"><h2 className="font-bold text-navy">Discount detail</h2></div>
              {discounts.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-500">No discounts in this selection.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-100">
                      <th className="px-6 py-3 font-semibold">Category</th>
                      <th className="px-6 py-3 font-semibold text-right">Students</th>
                      <th className="px-6 py-3 font-semibold text-right">Count</th>
                      <th className="px-6 py-3 font-semibold text-right">Money cut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {discounts.map(r => (
                      <tr key={r.category} className="hover:bg-gray-50/50">
                        <td className="px-6 py-3 font-medium text-navy">{CATEGORY_LABELS[r.category] || r.category}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-gray-600">{r.studentCount}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-gray-600">{r.discountCount}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-navy font-medium">{formatNaira(r.estAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <PeriodPicker
            terms={termItems}
            sessions={sessionItems}
            type={compareType}
            onType={t => { setCompareType(t); setCompareIds([]) }}
            selected={compareIds}
            onToggle={toggleCompare}
            onClear={() => setCompareIds([])}
          />

          {overlayMeaningful && (
            <CompareOverlay
              heading={overlayHeading}
              context={overlayContext}
              axisLabels={overlayAxis}
              series={overlaySeries}
              metric={overlayMetric}
              onMetric={setOverlayMetric}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CompareBars rows={compareRows} />
            <CompareRates rows={compareRows} />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-navy">Side-by-side</h2>
              {compareRows.length > 1 && <p className="text-xs text-gray-500 mt-0.5">▲/▼ shown vs {compareRows[0].label}</p>}
            </div>
            {compareRows.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-500">Pick up to 5 {compareType}s above to compare.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="px-6 py-3 font-semibold">Period</th>
                    <th className="py-3 pl-6 font-semibold text-right" style={{ paddingRight: '4.75rem' }}>Billed</th>
                    <th className="py-3 pl-6 font-semibold text-right" style={{ paddingRight: '4.75rem' }}>Collected</th>
                    <th className="py-3 pl-6 font-semibold text-right" style={{ paddingRight: '4.75rem' }}>Outstanding</th>
                    <th className="px-6 py-3 font-semibold text-right">Discounts</th>
                    <th className="px-6 py-3 font-semibold text-right">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {compareRows.map((r, i) => {
                    const base = compareRows[0]
                    const d = (cur: number, b: number) => (i === 0 || b === 0) ? null : Math.round(((cur - b) / b) * 100)
                    // Number + delta chip: the chip sits in a fixed-width slot so
                    // it never shifts the number's position — columns stay aligned.
                    const cell = (val: number, colorClass: string, pct: number | null, invert = false) => {
                      let chip: React.ReactNode = null
                      if (pct !== null && pct !== 0) {
                        const good = invert ? pct < 0 : pct > 0
                        chip = <span className={good ? 'text-mint' : 'text-red-400'}>{pct > 0 ? '▲' : '▼'}{Math.abs(pct)}%</span>
                      }
                      return (
                        <td className="px-6 py-3">
                          <div className="flex items-baseline justify-end gap-2">
                            <span className={`tabular-nums ${colorClass}`}>{formatNaira(val)}</span>
                            <span className="w-11 shrink-0 text-left text-xs">{chip}</span>
                          </div>
                        </td>
                      )
                    }
                    return (
                      <tr key={r.id} className="hover:bg-gray-50/50">
                        <td className="px-6 py-3 font-medium text-navy">{r.label}{i === 0 && compareRows.length > 1 && <span className="ml-1 text-xs text-gray-400">(base)</span>}</td>
                        {cell(r.billed, 'text-gray-600', d(r.billed, base.billed))}
                        {cell(r.collected, 'text-mint font-medium', d(r.collected, base.collected))}
                        {cell(r.outstanding, 'text-amber-600', d(r.outstanding, base.outstanding), true)}
                        <td className="px-6 py-3 text-right tabular-nums text-gray-600">{formatNaira(r.discountTotal)}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-navy font-medium">{r.rate}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
