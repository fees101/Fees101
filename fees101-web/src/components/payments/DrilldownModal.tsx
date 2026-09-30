'use client'

import { useEffect, useState } from 'react'
import type { DrilldownRow } from '@/lib/queries/analytics'

interface Props {
  title: string
  subtitle: string
  cycleIds: string[]
  className?: string
  feeName?: string
  showFinancials: boolean
  onClose: () => void
}

const MASKED = '••••'

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function statusChip(status: string): { color: string; label: string } {
  if (status === 'paid') return { color: 'var(--color-ledger)', label: 'PAID' }
  if (status === 'partial') return { color: 'var(--color-ochre-text)', label: 'PARTIAL' }
  if (status === 'overdue') return { color: 'var(--color-ochre-text)', label: 'OVERDUE' }
  return { color: 'var(--color-neutral-500)', label: 'UNPAID' }
}

// Row-click drill-down for the "By class" and "By fee" tables — reuses the
// invoice list's status convention (see InvoicesListLayout) rather than
// inventing a new one.
export default function DrilldownModal({ title, subtitle, cycleIds, className, feeName, showFinancials, onClose }: Props) {
  const [rows, setRows] = useState<DrilldownRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const amt = (v: number) => showFinancials ? formatNaira(v) : MASKED

  useEffect(() => {
    const params = new URLSearchParams({ cycleIds: cycleIds.join(',') })
    if (className) params.set('className', className)
    if (feeName) params.set('feeName', feeName)
    setRows(null)
    setError(null)
    fetch(`/api/analytics/drilldown?${params.toString()}`)
      .then(res => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json()
      })
      .then(data => setRows(data.rows || []))
      .catch(() => setError('Could not load students for this row.'))
  }, [cycleIds, className, feeName])

  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[60] flex items-center justify-center p-4 m-anim-fade">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-2xl w-full max-h-[80vh] flex flex-col m-anim-scale">
        <div className="p-6 border-b-2 border-[var(--color-ink)] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold tracking-[-0.01em] text-[var(--color-ink)] truncate">{title}</h3>
            <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)] flex-shrink-0">
            Close
          </button>
        </div>

        <div className="overflow-y-auto">
          {error && <p className="px-6 py-8 text-sm text-[var(--color-signal-text)]">{error}</p>}
          {!error && rows === null && (
            <div className="px-6 py-8">
              <div className="m-loading mb-3" />
              <p className="text-sm text-[var(--color-neutral-700)]">Loading students…</p>
            </div>
          )}
          {!error && rows?.length === 0 && <p className="px-6 py-8 text-sm text-[var(--color-neutral-700)]">No students found for this selection.</p>}
          {!error && rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="m-table min-w-[560px]">
                <thead className="sticky top-0 bg-[var(--color-paper)]">
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th className="text-right">Owed</th>
                    <th className="text-right">Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const chip = statusChip(r.status)
                    return (
                      <tr key={r.studentId}>
                        <td className="font-medium text-[var(--color-ink)]">{r.studentName}</td>
                        <td className="text-[var(--color-neutral-700)]">{r.className}</td>
                        <td className="text-right text-[var(--color-neutral-700)] m-num">{amt(r.amountOwed)}</td>
                        <td className="text-right text-[var(--color-ledger)] font-medium m-num">{amt(r.amountPaid)}</td>
                        <td>
                          <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.08em', color: chip.color }}>{chip.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end">
          <button onClick={onClose} className="m-btn m-btn-outline m-btn-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
