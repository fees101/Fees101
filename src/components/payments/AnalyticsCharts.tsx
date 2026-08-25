'use client'

import { useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'

export const MINT = '#34d399'
export const NAVY = '#1e293b'
export const AMBER = '#f59e0b'
export const GREY = '#cbd5e1'
export const RED = '#f87171'
export const PALETTE = ['#34d399', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#22d3ee', '#fb923c', '#4ade80', '#e879f9', '#facc15']

export function naira(v: number): string {
  return '₦' + Math.round(v).toLocaleString('en-NG')
}

// Masked stand-in for a currency figure when the viewer lacks
// see-financial-totals — used everywhere a raw amount would otherwise render.
export const MASKED = '••••'

// Compact axis labels: ₦1.2M / ₦450k.
export function nairaShort(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return '₦' + (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (a >= 1_000) return '₦' + Math.round(v / 1_000) + 'k'
  return '₦' + v
}

// showFinancials defaults true so existing call sites that don't pass it
// (percentage-only charts never route currency through this tooltip anyway)
// keep working unchanged.
export function ChartTooltip({ active, payload, label, showFinancials = true }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-navy text-white text-xs rounded-lg px-3 py-2 shadow-lg">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color || p.payload?.fill }}>
          {p.name}: {showFinancials ? naira(p.value) : MASKED}
        </p>
      ))}
    </div>
  )
}

// Tooltip for the rate/% views charts fall back to when see-financial-totals
// is off — a genuine number (not a masked placeholder), just relative instead
// of absolute.
export function RateTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-navy text-white text-xs rounded-lg px-3 py-2 shadow-lg">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color || p.payload?.fill }}>
          {p.name}: {p.value}%
        </p>
      ))}
    </div>
  )
}

export function Card({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-bold text-navy">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// =====================================================================
// Revenue for fees across terms. Shows ALL fees at once (a coloured line each)
// so you can compare what each brings in; focus a single fee to see billed vs
// collected for just that one.
// =====================================================================
interface FeeTrendData {
  name: string
  kind: 'required' | 'opt_in'
  points: { label: string; startDate: string; billed: number; collected: number }[]
}

export function FeeTrendChart({ fees, showFinancials = true }: { fees: FeeTrendData[]; showFinancials?: boolean }) {
  const [focus, setFocus] = useState<string>('__all__')
  if (fees.length === 0) {
    return <Card title="Revenue by fee over time"><p className="text-sm text-gray-500 py-8">No fees billed yet.</p></Card>
  }
  const yTick = showFinancials ? nairaShort : () => MASKED

  // Chronological union of every period label across all fees.
  const labelOrder: string[] = []
  const seen = new Map<string, string>()
  fees.flatMap(f => f.points).sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach(p => {
    if (!seen.has(p.label)) { seen.set(p.label, p.startDate); labelOrder.push(p.label) }
  })

  const selector = (
    <select value={focus} onChange={e => setFocus(e.target.value)}
      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-navy focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint max-w-[45vw]">
      <option value="__all__">All fees</option>
      {fees.map(f => (
        <option key={`${f.kind}-${f.name}`} value={f.name}>
          {f.name}{f.kind === 'opt_in' ? ' (optional)' : ''}
        </option>
      ))}
    </select>
  )

  const rateOf = (billed: number, collected: number) => billed > 0 ? Math.round((collected / billed) * 100) : 0

  // Focus one fee → billed vs collected for it (or its collection rate % when masked).
  if (focus !== '__all__') {
    const fee = fees.find(f => f.name === focus) || fees[0]

    if (!showFinancials) {
      const rateData = fee.points.map(p => ({ label: p.label, Rate: rateOf(p.billed, p.collected) }))
      return (
        <Card title="Revenue by fee over time" subtitle={`${fee.name} — collection rate over time`} action={selector}>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={rateData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: '#64748b' }} width={45} />
              <Tooltip content={<RateTooltip />} />
              <Line type="monotone" dataKey="Rate" name="Collection rate" stroke={MINT} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )
    }

    const data = fee.points.map(p => ({ label: p.label, Billed: p.billed, Collected: p.collected }))
    return (
      <Card title="Revenue by fee over time" subtitle={`${fee.name} — billed vs collected`} action={selector}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis tickFormatter={yTick} tick={{ fontSize: 12, fill: '#64748b' }} width={60} />
            <Tooltip content={<ChartTooltip showFinancials={showFinancials} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Billed" stroke={NAVY} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Collected" stroke={MINT} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    )
  }

  // All fees → one line per fee: billed (or collection rate % when masked), top 10 by lifetime billing.
  const top = fees.slice(0, 10)

  if (!showFinancials) {
    const rateData = labelOrder.map(label => {
      const row: Record<string, any> = { label }
      top.forEach(f => {
        const p = f.points.find(pp => pp.label === label)
        row[f.name] = p ? rateOf(p.billed, p.collected) : null
      })
      return row
    })
    return (
      <Card
        title="Revenue by fee over time"
        subtitle="Collection rate per fee across terms — compare how well each one collects"
        action={selector}
      >
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={rateData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: '#64748b' }} width={45} />
            <Tooltip content={<RateTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {top.map((f, i) => (
              <Line key={f.name} type="monotone" dataKey={f.name} stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>
    )
  }

  const data = labelOrder.map(label => {
    const row: Record<string, any> = { label }
    top.forEach(f => {
      const p = f.points.find(pp => pp.label === label)
      row[f.name] = p ? p.billed : null
    })
    return row
  })

  return (
    <Card
      title="Revenue by fee over time"
      subtitle="Billed per fee across terms — compare what each one brings in"
      action={selector}
    >
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
          <YAxis tickFormatter={yTick} tick={{ fontSize: 12, fill: '#64748b' }} width={60} />
          <Tooltip content={<ChartTooltip showFinancials={showFinancials} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {top.map((f, i) => (
            <Line key={f.name} type="monotone" dataKey={f.name} stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={2} dot={{ r: 2 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// =====================================================================
// Potential breakdown — one clear bar showing how the full potential (before
// discounts) splits into money collected, money still owed, and money given
// away as discounts. Easier to read at a glance than a waterfall.
// =====================================================================
export function PotentialBreakdown({
  grossPotential, discountTotal, billed, outstanding, collected, showFinancials = true,
}: {
  grossPotential: number; discountTotal: number; billed: number; outstanding: number; collected: number
  showFinancials?: boolean
}) {
  const total = grossPotential || 1
  const pct = (v: number) => Math.round((v / total) * 100)
  const collectedPct = pct(collected)
  const foregonePct = pct(discountTotal)
  const amt = (v: number) => showFinancials ? naira(v) : MASKED

  const segs = [
    { label: 'Collected', value: collected, color: MINT },
    { label: 'Still owed', value: outstanding, color: AMBER },
    { label: 'Given as discounts', value: discountTotal, color: RED },
  ].filter(s => s.value > 0)

  return (
    <Card
      title="Where the money goes"
      subtitle={`Of ${amt(grossPotential)} potential, ${collectedPct}% collected · ${foregonePct}% given as discounts`}
    >
      {/* Single composition bar — widths are a ratio (%), so this stays visible
          even without see-financial-totals; only the absolute-amount tooltip
          and stat rows below are masked. */}
      <div className="flex h-8 w-full rounded-lg overflow-hidden bg-gray-100">
        {segs.map(s => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${amt(s.value)}`} />
        ))}
      </div>

      {/* Stat rows */}
      <div className="mt-5 space-y-3">
        <StatRow color={GREY} label="Potential (before discounts)" value={amt(grossPotential)} bold />
        <StatRow color={RED} label="Given away as discounts" value={`− ${amt(discountTotal)}`} />
        <StatRow color={NAVY} label="Billed to families" value={amt(billed)} bold />
        <StatRow color={AMBER} label="Still outstanding" value={`− ${amt(outstanding)}`} />
        <StatRow color={MINT} label="Actually collected" value={amt(collected)} bold />
      </div>
    </Card>
  )
}

function StatRow({ color, label, value, bold = false }: {
  color: string; label: string; value: string; bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-gray-600">
        <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
        {label}
      </span>
      <span className={`tabular-nums ${bold ? 'font-bold text-navy' : 'text-gray-500'}`}>{value}</span>
    </div>
  )
}

// =====================================================================
// Revenue mix — share of collected money by fee (donut).
// =====================================================================
export function RevenueMix({ fees, showFinancials = true }: { fees: { name: string; collected: number }[]; showFinancials?: boolean }) {
  const data = fees.filter(f => f.collected > 0).map(f => ({ name: f.name, value: f.collected }))
  const total = data.reduce((s, d) => s + d.value, 0)

  function MixTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    const pct = total > 0 ? Math.round((p.value / total) * 100) : 0
    return (
      <div className="bg-navy text-white text-xs rounded-lg px-3 py-2 shadow-lg">
        <p className="font-semibold">{p.name}</p>
        <p>{showFinancials ? naira(p.value) : MASKED} · {pct}%</p>
      </div>
    )
  }

  return (
    <Card title="Revenue mix" subtitle="Share of collected money by fee">
      {data.length === 0 ? (
        <p className="text-sm text-gray-500 py-8">Nothing collected yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={65} outerRadius={110} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip content={<MixTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

// =====================================================================
// Collected vs outstanding per fee (stacked horizontal bars).
// =====================================================================
export function FeeCollectionBars({
  fees, showFinancials = true,
}: {
  fees: { name: string; collected: number; outstanding: number }[]
  showFinancials?: boolean
}) {
  if (!showFinancials) {
    const rateData = fees.slice(0, 12).map(f => {
      const total = f.collected + f.outstanding
      return { name: f.name, Rate: total > 0 ? Math.round((f.collected / total) * 100) : 0 }
    })
    return (
      <Card title="Collection rate, by fee" subtitle="Which fees are hard to collect">
        {rateData.length === 0 ? (
          <p className="text-sm text-gray-500 py-8">No fees billed.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, rateData.length * 38)}>
            <BarChart data={rateData} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} width={110} />
              <Tooltip content={<RateTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
              <Bar dataKey="Rate" name="Collection rate" fill={MINT} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    )
  }

  const data = fees.slice(0, 12).map(f => ({ name: f.name, Collected: f.collected, Outstanding: f.outstanding }))
  return (
    <Card title="Collected vs outstanding, by fee" subtitle="Which fees are hard to collect">
      {data.length === 0 ? (
        <p className="text-sm text-gray-500 py-8">No fees billed.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 38)}>
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tickFormatter={showFinancials ? nairaShort : () => MASKED} tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} width={110} />
            <Tooltip content={<ChartTooltip showFinancials={showFinancials} />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Collected" stackId="f" fill={MINT} radius={[0, 0, 0, 0]} />
            <Bar dataKey="Outstanding" stackId="f" fill={AMBER} radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

// =====================================================================
// Opt-in uptake — adoption % and revenue for each optional fee.
// =====================================================================
export function OptInUptake({
  fees, showFinancials = true,
}: {
  fees: { name: string; uptake: number; studentsBilled: number; collected: number }[]
  showFinancials?: boolean
}) {
  if (fees.length === 0) {
    return <Card title="Opt-in uptake" subtitle="How many students take each optional fee">
      <p className="text-sm text-gray-500 py-8">No optional fees in this scope.</p>
    </Card>
  }
  return (
    <Card title="Opt-in uptake" subtitle="Adoption of each optional fee — which ones are worth pushing">
      <div className="space-y-3">
        {fees.map(f => (
          <div key={f.name}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium text-navy">{f.name}</span>
              <span className="text-gray-500 tabular-nums">
                {f.uptake}% · {f.studentsBilled} students · {showFinancials ? naira(f.collected) : MASKED}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full bg-mint" style={{ width: `${Math.min(100, f.uptake)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

const CATEGORY_LABELS: Record<string, string> = {
  sibling_discount: 'Sibling',
  bursary: 'Bursary',
  staff_child: 'Staff child',
  financial_hardship: 'Hardship',
  scholarship: 'Scholarship',
  fee_waiver: 'Fee waiver',
  other: 'Other',
}

// =====================================================================
// Discounts by category (bar).
// =====================================================================
export function DiscountBar({
  rows, showFinancials = true,
}: {
  rows: { category: string; estAmount: number; discountCount: number; studentCount: number }[]
  showFinancials?: boolean
}) {
  if (!showFinancials) {
    const total = rows.reduce((s, r) => s + r.estAmount, 0) || 1
    const shareData = rows.map(r => ({
      label: CATEGORY_LABELS[r.category] || r.category,
      Share: Math.round((r.estAmount / total) * 100),
    }))
    return (
      <Card title="Discounts by category" subtitle="Share of total discounts given, by category">
        {shareData.length === 0 ? (
          <p className="text-sm text-gray-500 py-8">No discounts applied.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={shareData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: '#64748b' }} width={45} />
              <Tooltip content={<RateTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
              <Bar dataKey="Share" name="Share" radius={[6, 6, 0, 0]}>
                {shareData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    )
  }

  const data = rows.map(r => ({ label: CATEGORY_LABELS[r.category] || r.category, Amount: r.estAmount }))
  return (
    <Card title="Discounts by category" subtitle="Money cut off — estimated where an invoice has several discounts">
      {data.length === 0 ? (
        <p className="text-sm text-gray-500 py-8">No discounts applied.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis tickFormatter={showFinancials ? nairaShort : () => MASKED} tick={{ fontSize: 12, fill: '#64748b' }} width={60} />
            <Tooltip content={<ChartTooltip showFinancials={showFinancials} />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            <Bar dataKey="Amount" radius={[6, 6, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}
