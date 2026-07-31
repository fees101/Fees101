'use client'

import { useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Brush, Cell,
} from 'recharts'
import type { TermPoint } from '@/lib/queries/analytics'
import type { FeeChoice, FeePriceFan } from '@/lib/analytics/aggregate'
import { Card, ChartTooltip, naira, nairaShort, MINT, NAVY, AMBER, PALETTE } from './AnalyticsCharts'

export type PresetKey = 'all' | '12mo' | 'session' | 'term'

// The hero: a stock-market-style timeline of the whole history. Drag the brush
// (or use a preset) to zoom to any window — that selection drives every card
// below. Hover any point for that term's figures.
export function TimelineHero({
  terms, startIndex, endIndex, brushNonce, onBrush, preset, onPreset,
}: {
  terms: TermPoint[]
  startIndex: number
  endIndex: number
  brushNonce: number
  onBrush: (s: number, e: number) => void
  preset: PresetKey | null
  onPreset: (p: PresetKey) => void
}) {
  const data = terms.map(t => ({
    label: t.cycleName,
    Billed: t.billed,
    Collected: t.collected,
    Outstanding: t.outstanding,
  }))

  const presets: { key: PresetKey; label: string }[] = [
    { key: 'term', label: 'This term' },
    { key: 'session', label: 'This session' },
    { key: '12mo', label: 'Last 12 months' },
    { key: 'all', label: 'All' },
  ]

  const presetBtns = (
    <div className="flex flex-wrap gap-1 text-xs font-medium">
      {presets.map(p => (
        <button
          key={p.key}
          onClick={() => onPreset(p.key)}
          className={`px-2.5 py-1 rounded-md border transition-colors ${
            preset === p.key ? 'bg-navy text-white border-navy' : 'border-gray-200 text-gray-500 hover:text-navy hover:border-navy/40'
          }`}
        >{p.label}</button>
      ))}
    </div>
  )

  return (
    <Card
      title="Collection over time"
      subtitle="Drag the handles below to zoom — the whole page follows your selection"
      action={presetBtns}
    >
      {data.length === 0 ? (
        <p className="text-sm text-gray-500 py-8">No data yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tickFormatter={nairaShort} tick={{ fontSize: 12, fill: '#64748b' }} width={60} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Billed" stroke={NAVY} strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="Collected" stroke={MINT} strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="Outstanding" stroke={AMBER} strokeWidth={2} dot={{ r: 2 }} />
            <Brush
              key={brushNonce}
              dataKey="label"
              height={28}
              stroke="#94a3b8"
              travellerWidth={8}
              startIndex={startIndex}
              endIndex={endIndex}
              onChange={(r: any) => {
                if (typeof r?.startIndex === 'number' && typeof r?.endIndex === 'number') {
                  onBrush(r.startIndex, r.endIndex)
                }
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

// Head-to-head comparison of up to 5 chosen periods — grouped bars for billed
// vs collected, plus a rate read-out. Clearer than overlaid lines for a handful
// of discrete periods.
export function CompareBars({
  rows,
}: {
  rows: { label: string; billed: number; collected: number; rate: number }[]
}) {
  if (rows.length === 0) {
    return (
      <Card title="Comparison" subtitle="Pick periods to compare">
        <p className="text-sm text-gray-500 py-8">Select up to 5 periods to compare them side by side.</p>
      </Card>
    )
  }
  return (
    <Card title="Billed vs collected, by period" subtitle="Selected periods, side by side">
      <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 64)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 16, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tickFormatter={nairaShort} tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} width={130} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="billed" name="Billed" fill={NAVY} radius={[0, 4, 4, 0]} />
          <Bar dataKey="collected" name="Collected" fill={MINT} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

// Collection-rate bars for the compared periods (0–100%).
export function CompareRates({ rows }: { rows: { label: string; rate: number }[] }) {
  if (rows.length === 0) return null
  return (
    <Card title="Collection rate, by period" subtitle="Share of billing collected">
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 48)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} width={130} />
          <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} formatter={(v: any) => [`${v}%`, 'Rate']} />
          <Bar dataKey="rate" name="Rate" radius={[0, 4, 4, 0]}>
            {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

// Overlay line for compare mode. The parent picks the x-axis: term position
// (one line per year, years overlaid) when picks span several term positions,
// or the year itself (a trend line for a single term across years) when every
// pick is the same term position. Metric toggle: Collected / Billed / Both
// (Both draws collected solid + billed dashed in each line's colour).
export interface OverlaySeries { label: string; collected: (number | null)[]; billed: (number | null)[] }
export function CompareOverlay({
  heading, context, axisLabels, series, metric, onMetric,
}: {
  heading: string
  context: string
  axisLabels: string[]
  series: OverlaySeries[]
  metric: 'collected' | 'billed' | 'both'
  onMetric: (m: 'collected' | 'billed' | 'both') => void
}) {
  const both = metric === 'both'

  // Build the row set with a dataKey per drawn line.
  const data = axisLabels.map((label, i) => {
    const row: Record<string, any> = { label }
    series.forEach(s => {
      if (both) {
        row[`${s.label} · collected`] = s.collected[i] ?? null
        row[`${s.label} · billed`] = s.billed[i] ?? null
      } else {
        row[s.label] = (metric === 'collected' ? s.collected[i] : s.billed[i]) ?? null
      }
    })
    return row
  })

  const metricToggle = (
    <div className="flex rounded-lg border border-gray-200 p-0.5 text-xs font-medium">
      {(['collected', 'billed', 'both'] as const).map(m => (
        <button key={m} onClick={() => onMetric(m)}
          className={`px-3 py-1 rounded-md capitalize transition-colors ${metric === m ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'}`}>{m}</button>
      ))}
    </div>
  )

  if (series.length === 0 || axisLabels.length === 0) return null

  const metricWord = both ? 'billed & collected' : metric
  return (
    <Card
      title={heading}
      subtitle={both ? `billed (dashed) & collected (solid) ${context}` : `${metricWord} ${context}`}
      action={metricToggle}
    >
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis tickFormatter={nairaShort} tick={{ fontSize: 12, fill: '#64748b' }} width={60} />
          <Tooltip content={<ChartTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => {
            const color = PALETTE[i % PALETTE.length]
            if (!both) {
              return <Line key={s.label} type="monotone" dataKey={s.label} stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            }
            return [
              <Line key={`${s.label}-c`} type="monotone" dataKey={`${s.label} · collected`} stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls />,
              <Line key={`${s.label}-b`} type="monotone" dataKey={`${s.label} · billed`} stroke={color} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} connectNulls />,
            ]
          })}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// Fee price over time — a line per class (the "fan"). Pick a fee; watch its
// price climb across terms and see how it varies per class. A single-price fee
// collapses to one "All classes" line.
export function FeePriceChart({
  choices, fan, selected, onSelect,
}: {
  choices: FeeChoice[]
  fan: FeePriceFan
  selected: string
  onSelect: (name: string) => void
}) {
  if (choices.length === 0) {
    return (
      <Card title="Fee price over time" subtitle="How each fee's price has changed">
        <p className="text-sm text-gray-500 py-8">
          No fee-price data. If this stays empty after selecting a wider range, re-run
          {' '}<code className="bg-gray-100 px-1 rounded">db/analytics_functions.sql</code> (adds the fee-price function).
        </p>
      </Card>
    )
  }

  const selector = (
    <select value={selected} onChange={e => onSelect(e.target.value)}
      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-navy focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint max-w-[45vw]">
      {choices.map(c => (
        <option key={`${c.kind}-${c.name}`} value={c.name}>
          {c.name}{c.kind === 'opt_in' ? ' (optional)' : ''}
        </option>
      ))}
    </select>
  )

  // Uniform → one line keyed on the first class; else one line per class.
  const lineKeys = fan.uniform && fan.classes.length > 0 ? [fan.classes[0]] : fan.classes
  const data = fan.points.map(p => {
    const row: Record<string, any> = { label: p.label }
    if (fan.uniform) {
      const v = fan.classes.length ? p.prices[fan.classes[0]] : null
      row['All classes'] = v
    } else {
      fan.classes.forEach(cl => { row[cl] = p.prices[cl] })
    }
    return row
  })
  const keys = fan.uniform ? ['All classes'] : lineKeys

  function PriceTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-navy text-white text-xs rounded-lg px-3 py-2 shadow-lg max-w-[240px]">
        <p className="font-semibold mb-1">{label}</p>
        {payload.filter((p: any) => p.value != null).map((p: any) => (
          <p key={p.name} style={{ color: p.color }}>{p.name}: {naira(p.value)}</p>
        ))}
      </div>
    )
  }

  return (
    <Card
      title="Fee price over time"
      subtitle={fan.uniform
        ? `${selected} — one price for all classes across terms`
        : `${selected} — price per class across terms (varies by class)`}
      action={selector}
    >
      {data.length === 0 ? (
        <p className="text-sm text-gray-500 py-8">No price history for this fee in the selected range.</p>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis tickFormatter={nairaShort} tick={{ fontSize: 12, fill: '#64748b' }} width={60} />
            <Tooltip content={<PriceTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}
