'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { startBulkDVAJob } from '@/app/(app)/students/[id]/actions'
import { useActiveJobs, useTrackedJob } from '@/lib/jobs/ActiveJobsProvider'

interface Props {
  count: number
  href: string
  onClose: () => void
}

export default function BulkDVAPanel({ count, href, onClose }: Props) {
  const router = useRouter()
  const { trackJob, findRunningJob, cancelJob } = useActiveJobs()
  const existing = findRunningJob(j => j.jobType === 'bulk_dva')
  const [jobId, setJobId] = useState<string | null>(existing?.jobId ?? null)
  const [startError, setStartError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(!!existing)
  const started = useRef(!!existing)

  const job = useTrackedJob(jobId)

  useEffect(() => {
    if (!confirmed || started.current) return
    started.current = true

    async function run() {
      const start = await startBulkDVAJob()
      if ('error' in start) {
        setStartError(start.error ?? 'Something went wrong')
        return
      }
      if (!start.jobId) {
        setStartError('No accounts to create.')
        return
      }
      trackJob(start.jobId, 'bulk_dva', 'Creating payment accounts', {
        processed: start.processed ?? 0,
        total: start.total ?? 0,
      }, () => router.refresh(), { href })
      setJobId(start.jobId)
    }
    run()
  }, [confirmed, trackJob, router, href])

  const error = startError || job?.error
  const result = job && job.status !== 'running' ? job : null
  const creating = confirmed && !result && !error

  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-2xl w-full max-h-[90vh] flex flex-col m-anim-scale">

        <div className="p-5 border-b-2 border-[var(--color-ink)] flex items-center justify-between">
          <h3 className="text-base font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">
            {!confirmed ? 'Create payment accounts' : result ? 'Accounts created' : 'Creating payment accounts'}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!confirmed && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-neutral-700)]">
                This will create a virtual account for {count} student{count === 1 ? '' : 's'} who don&apos;t have one yet, so parents can pay by transfer.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="m-btn m-btn-outline"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setConfirmed(true)}
                  className="m-btn m-btn-primary"
                >
                  Create {count}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {error}
            </div>
          )}

          {creating && !error && (
            <div className="py-10 flex flex-col items-center gap-4">
              <p className="text-sm text-[var(--color-neutral-700)] m-num">
                Creating... {job?.processed ?? 0}/{job?.total ?? 0}
              </p>
              <div className="w-full max-w-xs">
                {job && job.total > 0 ? (
                  <div className="h-[3px] bg-[var(--color-neutral-300)]">
                    <div
                      className="h-full bg-[var(--color-ink)] transition-all"
                      style={{ transitionDuration: 'var(--dur-settle)', width: `${Math.min(100, (job.processed / job.total) * 100)}%` }}
                    />
                  </div>
                ) : (
                  <div className="m-loading" />
                )}
              </div>
              {jobId && (
                <button
                  onClick={() => cancelJob(jobId)}
                  className="text-xs font-semibold text-[var(--color-signal-text)] hover:underline"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={onClose}
                className="mt-2 m-btn m-btn-outline"
              >
                Run in background
              </button>
              <p className="text-xs text-[var(--color-neutral-500)]">
                You can keep working elsewhere — you&apos;ll get a notification when this finishes.
              </p>
            </div>
          )}

          {result && result.status === 'cancelled' && (
            <div className="p-4 bg-[color-mix(in_srgb,var(--color-ochre)_10%,transparent)] border-l-[3px] border-[var(--color-ochre)] text-sm text-[var(--color-ochre-text)]">
              Cancelled — <strong>{result.processed}</strong> account{result.processed === 1 ? '' : 's'} created before stopping.
            </div>
          )}

          {result && result.status === 'completed' && (
            <div className="space-y-4">
              <div className="p-4 border-2 border-[var(--color-ink)]">
                <p className="text-sm font-semibold text-[var(--color-ink)] mb-2">Done</p>
                <ul className="space-y-1 text-sm text-[var(--color-neutral-700)]">
                  <li><strong className="text-[var(--color-ink)] m-num">{result.processed}</strong> account{result.processed === 1 ? '' : 's'} created</li>
                  {(result.failures?.length ?? 0) > 0 && (
                    <li className="text-[var(--color-ochre-text)]">{result.failures!.length} failed — see below</li>
                  )}
                </ul>
              </div>

              {(result.failures?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs text-[var(--color-neutral-700)] uppercase tracking-wider mb-2">
                    Failed ({result.failures!.length}) — you can retry, accounts already created won&apos;t be duplicated
                  </p>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
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
                            <td className="text-[var(--color-ochre-text)]">{s.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full m-btn m-btn-primary"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
