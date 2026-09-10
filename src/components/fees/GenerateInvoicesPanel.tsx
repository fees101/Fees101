'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startInvoiceGenerationJob } from '@/app/(app)/fees/cycles/actions'
import { useActiveJobs, useTrackedJob } from '@/lib/jobs/ActiveJobsProvider'

interface Props {
  cycleId: string
  onClose: () => void
  onSuccess: () => void
}

export default function GenerateInvoicesPanel({ cycleId, onClose, onSuccess }: Props) {
  const router = useRouter()
  const { trackJob, findRunningJob } = useActiveJobs()
  const existing = findRunningJob(j => j.jobType === 'invoice_generation' && j.meta?.cycleId === cycleId)
  const [jobId, setJobId] = useState<string | null>(existing?.jobId ?? null)
  const [startError, setStartError] = useState<string | null>(null)
  const [alreadyHad, setAlreadyHad] = useState(0)
  const started = useRef(!!existing)

  const job = useTrackedJob(jobId)

  useEffect(() => {
    if (started.current) return
    started.current = true

    async function run() {
      const start = await startInvoiceGenerationJob(cycleId)
      if ('error' in start) {
        setStartError(start.error ?? 'Something went wrong')
        return
      }
      setAlreadyHad(start.alreadyHad || 0)
      trackJob(start.jobId, 'invoice_generation', 'Invoice generation', {
        processed: start.processed ?? 0,
        total: start.total ?? 0,
      }, (job) => {
        if (job.status !== 'failed') router.refresh()
      }, { cycleId, href: `/fees/cycles/${cycleId}` })
      setJobId(start.jobId)
    }
    run()
  }, [cycleId, trackJob, router])

  const error = startError || job?.error
  const result = job && job.status !== 'running' ? job : null
  const generating = !result && !error

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">

        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-navy">
            {result ? 'Invoices generated' : 'Generating invoices'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {generating && !error && (
            <div className="py-10 flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-mint border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-600">
                Generating... {job?.processed ?? 0}/{job?.total ?? 0}
              </p>
              <div className="w-full max-w-xs h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-mint transition-all duration-500"
                  style={{
                    width: `${job && job.total > 0 ? Math.min(100, (job.processed / job.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Run in background
              </button>
              <p className="text-xs text-gray-400">
                You can keep working elsewhere — you&apos;ll get a notification when this finishes.
              </p>
            </div>
          )}

          {result && result.status === 'completed' && (
            <div className="space-y-4">
              <div className="p-4 bg-mint-light/40 border border-mint/30 rounded-xl">
                <p className="text-sm font-medium text-navy mb-2">Done</p>
                <ul className="space-y-1 text-sm text-gray-700">
                  <li><strong className="text-mint">{result.processed}</strong> invoices generated</li>
                  {alreadyHad > 0 && <li>{alreadyHad} already had an invoice (skipped)</li>}
                  {(result.failures?.length ?? 0) > 0 && (
                    <li className="text-amber-700">{result.failures!.length} skipped — see below</li>
                  )}
                </ul>
              </div>

              {(result.failures?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                    Skipped ({result.failures!.length}) — fix and regenerate
                  </p>
                  <div className="border border-amber-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-amber-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-medium text-amber-800 uppercase">Student</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-amber-800 uppercase">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100">
                        {result.failures!.map((s, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-navy">{s.label}</td>
                            <td className="px-3 py-2 text-amber-700">{s.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                onClick={onSuccess}
                className="w-full px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
              >
                View invoices
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
