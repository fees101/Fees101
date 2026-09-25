'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startBulkSend } from '@/app/(app)/money/invoices/actions'
import { useActiveJobs, useTrackedJob } from '@/lib/jobs/ActiveJobsProvider'

interface Props {
  count: number
  onClose: () => void
  // Scopes the job to needs_resend invoices only, and skips straight to the
  // progress view — used by the dashboard's "Resend now" action, where the
  // click itself (from the "Needs you" choice) already is the confirmation.
  onlyNeedsResend?: boolean
  skipConfirm?: boolean
}

export default function BulkSendInvoicesPanel({ count, onClose, onlyNeedsResend, skipConfirm }: Props) {
  const router = useRouter()
  const { trackJob, findRunningJob, cancelJob } = useActiveJobs()
  const existing = findRunningJob(j => j.jobType === 'bulk_send')
  const [jobId, setJobId] = useState<string | null>(existing?.jobId ?? null)
  const [startError, setStartError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(!!existing || !!skipConfirm)
  const started = useRef(!!existing)

  const job = useTrackedJob(jobId)

  useEffect(() => {
    if (!confirmed || started.current) return
    started.current = true

    async function run() {
      const start = await startBulkSend({ onlyNeedsResend })
      if ('error' in start) {
        setStartError(start.error ?? 'Something went wrong')
        return
      }
      if (!start.jobId) {
        setStartError('Nothing to send.')
        return
      }
      trackJob(start.jobId, 'bulk_send', 'Sending invoices', {
        processed: start.processed ?? 0,
        total: start.total ?? 0,
      }, () => router.refresh(), { href: '/money/invoices' })
      setJobId(start.jobId)
    }
    run()
  }, [confirmed, trackJob, router, onlyNeedsResend])

  const error = startError || job?.error
  const result = job && job.status !== 'running' ? job : null
  const sending = confirmed && !result && !error

  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-2xl w-full max-h-[90vh] flex flex-col m-anim-scale">

        <div className="p-5 border-b-2 border-[var(--color-ink)] flex items-center justify-between">
          <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]">
            {!confirmed ? (onlyNeedsResend ? 'Resend changed invoices' : 'Send all invoices') : result ? 'Invoices sent' : 'Sending invoices'}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!confirmed && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-neutral-700)]">
                {onlyNeedsResend
                  ? `This will resend ${count} changed invoice${count === 1 ? '' : 's'} to their parents by SMS and/or email now.`
                  : `This will send ${count} unsent/needs-resend invoice${count === 1 ? '' : 's'} by SMS and/or email now.`}
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="m-btn m-btn-outline">
                  Cancel
                </button>
                <button onClick={() => setConfirmed(true)} className="m-btn m-btn-primary">
                  Send {count}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {error}
            </div>
          )}

          {sending && !error && (
            <div className="py-10 flex flex-col items-center gap-4">
              <p className="text-sm text-[var(--color-neutral-700)] m-num">
                Sending... {job?.processed ?? 0}/{job?.total ?? 0}
              </p>
              <div className="w-full max-w-xs h-[2px] bg-[var(--color-neutral-300)]">
                <div
                  className="h-full bg-[var(--color-ink)] transition-all duration-500"
                  style={{
                    width: `${job && job.total > 0 ? Math.min(100, (job.processed / job.total) * 100) : 0}%`,
                  }}
                />
              </div>
              {jobId && (
                <button
                  onClick={() => cancelJob(jobId)}
                  className="text-xs text-[var(--color-signal-text)] hover:underline"
                >
                  Cancel send
                </button>
              )}
              <button onClick={onClose} className="m-btn m-btn-outline m-btn-sm mt-2">
                Run in background
              </button>
              <p className="text-xs text-[var(--color-neutral-500)]">
                You can keep working elsewhere — you&apos;ll get a notification when this finishes.
              </p>
            </div>
          )}

          {result && result.status === 'cancelled' && (
            <div className="p-4 bg-[var(--color-surface)] border-l-[3px] border-[var(--color-ochre)] text-sm text-[var(--color-ochre-text)]">
              Cancelled — <strong>{result.processed}</strong> invoice{result.processed === 1 ? '' : 's'} sent before stopping.
            </div>
          )}

          {result && result.status === 'completed' && (
            <div className="space-y-4">
              <div className="p-4 bg-[var(--color-surface)] border-l-[3px] border-[var(--color-ink)]">
                <p className="text-sm font-medium text-[var(--color-ink)] mb-2">Done</p>
                <ul className="space-y-1 text-sm text-[var(--color-ink)]">
                  <li><strong className="text-[var(--color-ink)] m-num">{result.processed}</strong> invoice{result.processed === 1 ? '' : 's'} sent</li>
                  {(result.failures?.length ?? 0) > 0 && (
                    <li className="text-[var(--color-ochre-text)]">{result.failures!.length} failed — see below</li>
                  )}
                </ul>
              </div>

              {(result.failures?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neutral-700)] mb-2">
                    Failed ({result.failures!.length})
                  </p>
                  <div className="border-2 border-[var(--color-ink)] max-h-64 overflow-y-auto overflow-x-auto">
                    <table className="m-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.failures!.map((s, i) => (
                          <tr key={i}>
                            <td className="text-[var(--color-ink)]">{s.label}</td>
                            <td className="text-[var(--color-signal-text)]">{s.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button onClick={onClose} className="m-btn m-btn-primary w-full">
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
