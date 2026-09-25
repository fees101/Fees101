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

export default function CollectionChart({ data }: CollectionChartProps) {
  // Worst first: the classes furthest from collected sit at the top, where
  // they need attention, not in roster order.
  const rows = [...data].sort((a, b) => a.percentage - b.percentage)

  return (
    <section className="m-panel">
      <h2 className="text-[22px] font-extrabold text-[var(--color-ink)] mb-1">Collection by class</h2>
      <p className="text-[14px] text-[var(--color-neutral-800)] mb-4">
        Green is collected, ochre is outstanding. Sorted worst first — the point of the chart is to find the problem class.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-neutral-700)]">No invoices yet for the current term.</p>
      ) : (
        rows.map(cls => {
          const collectedPct = cls.expected > 0 ? Math.min(100, (cls.collected / cls.expected) * 100) : 0
          const outstandingPct = cls.expected > 0 ? Math.max(0, 100 - collectedPct) : 0
          return (
            <div
              key={cls.class}
              className="grid items-center gap-3.5 py-[7px]"
              style={{ gridTemplateColumns: '76px minmax(0,1fr) 54px' }}
              title={`${cls.class}: ${cls.percentage}% collected · ${cls.outstanding.toLocaleString('en-NG')} outstanding`}
            >
              <span className="text-[13px] font-semibold text-[var(--color-ink)] truncate">{cls.class}</span>
              <span className="flex h-3.5 w-full bg-[var(--color-neutral-200)]">
                <span className="h-full bg-[var(--color-ledger)]" style={{ width: `${collectedPct}%` }} />
                <span className="h-full bg-[var(--color-ochre)]" style={{ width: `${outstandingPct}%` }} />
              </span>
              <span className="text-[13px] text-[var(--color-neutral-800)] text-right m-num">{cls.percentage}%</span>
            </div>
          )
        })
      )}
    </section>
  )
}
