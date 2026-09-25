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
  const { trackJob, findRunningJob, cancelJob } = useActiveJobs()
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
  const progressPct = job && job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0

  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-2xl w-full max-h-[90vh] flex flex-col m-anim-scale">

        <div className="p-5 border-b-2 border-[var(--color-ink)] flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            {result ? 'Invoices generated' : 'Generating invoices'}
          </h3>
          <button onClick={onClose} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="pl-3 py-2 border-l-2 border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {error}
            </div>
          )}

          {generating && !error && (
            <div className="py-10 flex flex-col items-center gap-3">
              <p className="text-sm text-[var(--color-neutral-700)] m-num">
                Generating... {job?.processed ?? 0}/{job?.total ?? 0}
              </p>
              <div className="w-full max-w-xs h-2 bg-[var(--color-neutral-200)]">
                <div
                  className="h-full bg-[var(--color-ink)] transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {jobId && (
                <button
                  onClick={() => cancelJob(jobId)}
                  disabled={job?.cancelling}
                  className="text-xs text-[var(--color-signal-text)] hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {job?.cancelling ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
              <button onClick={onClose} className="m-btn m-btn-outline m-btn-sm mt-2">
                Run in background
              </button>
              <p className="text-xs text-[var(--color-neutral-500)]">
                You can keep working elsewhere, you&apos;ll get a notification when this finishes.
              </p>
            </div>
          )}

          {result && result.status === 'cancelled' && (
            <div className="pl-3 py-2 border-l-2 border-[var(--color-ochre)] text-sm text-[var(--color-ochre-text)]">
              Cancelled - <strong>{result.processed}</strong> invoice{result.processed === 1 ? '' : 's'} generated before stopping.
            </div>
          )}

          {result && result.status === 'completed' && (
            <div className="space-y-4">
              <div className="border-t-2 border-[var(--color-ink)] pt-4">
                <p className="text-sm font-medium text-[var(--color-ink)] mb-2">Done</p>
                <ul className="space-y-1 text-sm text-[var(--color-neutral-700)]">
                  <li><strong className="text-[var(--color-ink)] m-num">{result.processed}</strong> invoices generated</li>
                  {alreadyHad > 0 && <li>{alreadyHad} already had an invoice (skipped)</li>}
                  {(result.failures?.length ?? 0) > 0 && (
                    <li className="text-[var(--color-ochre-text)]">{result.failures!.length} skipped, see below</li>
                  )}
                </ul>
              </div>

              {(result.failures?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs text-[var(--color-neutral-700)] uppercase tracking-wider mb-2">
                    Skipped ({result.failures!.length}) - fix and regenerate
                  </p>
                  <div className="border border-[var(--color-neutral-300)] max-h-64 overflow-y-auto overflow-x-auto">
                    <table className="m-table">
                      <thead className="sticky top-0 bg-[var(--color-paper)]">
                        <tr>
                          <th className="text-left">Student</th>
                          <th className="text-left">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.failures!.map((s, i) => (
                          <tr key={i}>
                            <td className="text-[var(--color-ink)]">{s.label}</td>
                            <td className="text-[var(--color-ochre-text)]">{s.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button onClick={onSuccess} className="m-btn m-btn-primary w-full">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
