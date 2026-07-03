'use client'

import { useState, useEffect } from 'react'
import { previewInvoicesForCycle, generateInvoicesForCycle } from '@/app/(app)/fees/cycles/actions'

interface Props {
  cycleId: string
  onClose: () => void
  onSuccess: () => void
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

interface PreviewData {
  cycleName: string
  toGenerateCount: number
  alreadyHaveCount: number
  noClassCount: number
  skippedTotalCount: number
  totalExpected: number
  preview: Array<{
    studentId: string
    studentName: string
    className: string
    total: number
    warning?: string
  }>
}

export default function GenerateInvoicesPanel({ cycleId, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{ generated: number, alreadyHad: number, errors: number } | null>(null)

  useEffect(() => {
    async function load() {
      const r = await previewInvoicesForCycle(cycleId)
      if ('error' in r) {
        setError(r.error)
      } else {
        setPreview(r as PreviewData)
      }
      setLoading(false)
    }
    load()
  }, [cycleId])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    const r = await generateInvoicesForCycle(cycleId)
    if ('error' in r) {
      setError(r.error)
      setGenerating(false)
      return
    }
    setResult({
      generated: r.generated || 0,
      alreadyHad: r.alreadyHad || 0,
      errors: (r.errors || []).length,
    })
    setGenerating(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">

        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-navy">
            {result ? 'Invoices generated' : 'Generate invoices'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <p className="text-center text-gray-500 py-8">Loading preview...</p>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="p-4 bg-mint-light/40 border border-mint/30 rounded-xl">
                <p className="text-sm font-medium text-navy mb-2">Done</p>
                <ul className="space-y-1 text-sm text-gray-700">
                  <li><strong className="text-mint">{result.generated}</strong> invoices generated</li>
                  {result.alreadyHad > 0 && <li>{result.alreadyHad} already existed (skipped)</li>}
                  {result.errors > 0 && <li className="text-red-700">{result.errors} errors</li>}
                </ul>
              </div>
              <button
                onClick={onSuccess}
                className="w-full px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
              >
                View invoices
              </button>
            </div>
          )}

          {!loading && !result && preview && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                Review before generating. Invoices will be created as drafts (not yet marked sent).
              </p>

              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">New invoices to generate</span>
                  <span className="font-semibold text-navy">{preview.toGenerateCount}</span>
                </div>
                {preview.alreadyHaveCount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Already have invoice (will skip)</span>
                    <span className="text-gray-700">{preview.alreadyHaveCount}</span>
                  </div>
                )}
                {preview.noClassCount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-amber-700">Students with no class (will skip)</span>
                    <span className="text-amber-700">{preview.noClassCount}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                  <span className="text-gray-700 font-medium">Total expected revenue</span>
                  <span className="font-bold text-navy">{formatNaira(preview.totalExpected)}</span>
                </div>
              </div>

              {preview.noClassCount > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                  ⚠️ {preview.noClassCount} {preview.noClassCount === 1 ? 'student has' : 'students have'} no class assigned and will be skipped. Assign their class first if you want them invoiced.
                </div>
              )}

              {preview.preview.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Preview ({preview.preview.length})</p>
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Student</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Class</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {preview.preview.map(p => (
                          <tr key={p.studentId}>
                            <td className="px-3 py-2 text-navy">{p.studentName}</td>
                            <td className="px-3 py-2 text-gray-600">{p.className}</td>
                            <td className="px-3 py-2 text-right text-navy font-medium">
                              {formatNaira(p.total)}
                              {p.warning && (
                                <p className="text-xs text-amber-600 mt-0.5">{p.warning}</p>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!result && (
          <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={generating}
              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || loading || !preview || preview.toGenerateCount === 0}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
            >
              {generating ? 'Generating...' : preview ? `Generate ${preview.toGenerateCount} invoices` : 'Generate'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}