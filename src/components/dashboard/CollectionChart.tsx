'use client'

import { useState } from 'react'

interface ClassData {
  class: string
  studentCount: number
  invoicedCount: number
  expected: number
  collected: number
  outstanding: number
  percentage: number
}

interface CollectionChartProps {
  data: ClassData[]
}

function formatNaira(value: number): string {
  return '₦' + value.toLocaleString('en-NG')
}

type View = 'bullet' | 'table'

const LABEL_COL = '120px'
const VALUE_COL = '52px'
const GRID_COLS = `${LABEL_COL} 1fr ${VALUE_COL}`

function RowTooltip({ cls }: { cls: ClassData }) {
  return (
    <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity absolute left-0 top-full mt-1 z-20 bg-navy text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
      <p className="font-semibold mb-1">{cls.class}</p>
      <p>Collected: {formatNaira(cls.collected)}</p>
      <p>Expected: {formatNaira(cls.expected)}</p>
      {cls.outstanding > 0 && <p>Outstanding: {formatNaira(cls.outstanding)}</p>}
      <p className="text-gray-300 mt-1">
        {cls.studentCount} {cls.studentCount === 1 ? 'student' : 'students'} · {cls.invoicedCount} invoiced
      </p>
    </div>
  )
}

export default function CollectionChart({ data }: CollectionChartProps) {
  const [view, setView] = useState<View>('bullet')

  if (data.length === 0) {
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200">
        <h2 className="text-navy font-semibold text-lg mb-2">Collection by class</h2>
        <p className="text-gray-500 text-sm">No invoices yet for current term.</p>
      </div>
    )
  }

  const maxPercentage = Math.max(100, ...data.map(d => d.percentage))
  // Always leave headroom past the furthest bar (and the 100% line) so
  // nothing ever renders flush against the right edge.
  const scaleMax = Math.ceil((maxPercentage + 20) / 20) * 20
  const targetLeft = (100 / scaleMax) * 100

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200">
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <div>
          <h2 className="text-navy font-semibold text-lg">Collection by class</h2>
          <p className="text-gray-500 text-xs mt-0.5">Current term, by class order</p>
        </div>
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 flex-shrink-0">
          {(['bullet', 'table'] as View[]).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`text-xs font-medium rounded-md px-2.5 py-1.5 capitalize transition-colors ${
                view === v ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
              }`}
            >
              {v === 'bullet' ? 'Bullet' : 'Table'}
            </button>
          ))}
        </div>
      </div>

      {view === 'bullet' && (
        <>
          <div className="mt-4 space-y-2">
            {data.map(cls => {
              const barWidth = Math.min(100, (cls.percentage / scaleMax) * 100)
              const band1 = (50 / scaleMax) * 100
              const band2 = (80 / scaleMax) * 100
              return (
                <div
                  key={cls.class}
                  tabIndex={0}
                  className="group relative grid items-center gap-2 outline-none rounded-lg focus-visible:ring-2 focus-visible:ring-mint"
                  style={{ gridTemplateColumns: GRID_COLS }}
                >
                  <p className="text-sm font-medium text-navy truncate">{cls.class}</p>

                  {/* Qualitative zone bands (red/amber/green) with the navy measure bar on top and a target tick at 100%. */}
                  <div className="relative h-5 flex items-center">
                    <div className="absolute inset-0 flex rounded-sm overflow-hidden">
                      <div className="h-full bg-red-500/20" style={{ width: `${band1}%` }} />
                      <div className="h-full bg-amber-500/20" style={{ width: `${band2 - band1}%` }} />
                      <div className="h-full bg-mint/25" style={{ width: `${100 - band2}%` }} />
                    </div>
                    <div
                      className="relative h-2 rounded-r-sm bg-navy"
                      style={{ width: `${barWidth}%` }}
                    />
                    {/* Comparative marker — the term target, taller than the measure bar so it reads as a tick. */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-navy/70"
                      style={{ left: `${targetLeft}%` }}
                    />
                  </div>

                  <p className="text-sm font-semibold text-navy text-right tabular-nums">
                    {cls.percentage}%
                  </p>

                  <RowTooltip cls={cls} />
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            Navy bar = collected. Tick = term target (100%). Band shade = zone (red under 50%, amber 50–79%, green 80%+).
          </p>
        </>
      )}

      {view === 'table' && (
        <div className="mt-4 -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs border-b border-gray-100">
                <th className="font-medium py-2 px-1">Class</th>
                <th className="font-medium py-2 px-1 text-right">Students</th>
                <th className="font-medium py-2 px-1 text-right">Invoiced</th>
                <th className="font-medium py-2 px-1 text-right">Collected</th>
                <th className="font-medium py-2 px-1 text-right">Expected</th>
                <th className="font-medium py-2 px-1 text-right">Outstanding</th>
                <th className="font-medium py-2 px-1 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {data.map(cls => (
                <tr key={cls.class} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 px-1 text-navy font-medium">{cls.class}</td>
                  <td className="py-2 px-1 text-right text-gray-500 tabular-nums">{cls.studentCount}</td>
                  <td className="py-2 px-1 text-right text-gray-500 tabular-nums">{cls.invoicedCount}</td>
                  <td className="py-2 px-1 text-right text-navy tabular-nums">{formatNaira(cls.collected)}</td>
                  <td className="py-2 px-1 text-right text-gray-500 tabular-nums">{formatNaira(cls.expected)}</td>
                  <td className="py-2 px-1 text-right text-gray-500 tabular-nums">{formatNaira(cls.outstanding)}</td>
                  <td className="py-2 px-1 text-right font-semibold text-navy tabular-nums">{cls.percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
