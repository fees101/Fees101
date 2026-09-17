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

function statusBadge(status: string) {
  if (status === 'paid') return { cls: 'bg-mint-light text-mint', label: 'paid' }
  if (status === 'partial') return { cls: 'bg-amber-50 text-amber-700', label: 'partial' }
  if (status === 'overdue') return { cls: 'bg-red-50 text-red-700', label: 'overdue' }
  return { cls: 'bg-gray-100 text-gray-600', label: 'unpaid' }
}

// Row-click drill-down for the "By class" and "By fee" tables — reuses the
// invoice list's status-badge convention (see InvoicesListLayout) rather than
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
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-navy">{title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto">
          {error && <p className="px-6 py-8 text-sm text-red-600">{error}</p>}
          {!error && rows === null && <p className="px-6 py-8 text-sm text-gray-500">Loading…</p>}
          {!error && rows?.length === 0 && <p className="px-6 py-8 text-sm text-gray-500">No students found for this selection.</p>}
          {!error && rows && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="px-6 py-3 font-semibold">Student</th>
                  <th className="px-6 py-3 font-semibold">Class</th>
                  <th className="px-6 py-3 font-semibold text-right">Owed</th>
                  <th className="px-6 py-3 font-semibold text-right">Paid</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => {
                  const badge = statusBadge(r.status)
                  return (
                    <tr key={r.studentId} className="hover:bg-gray-50/50">
                      <td className="px-6 py-3 font-medium text-navy">{r.studentName}</td>
                      <td className="px-6 py-3 text-gray-600">{r.className}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-gray-600">{amt(r.amountOwed)}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-mint font-medium">{amt(r.amountPaid)}</td>
                      <td className="px-6 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex items-center justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
