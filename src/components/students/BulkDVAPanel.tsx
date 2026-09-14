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
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">

        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-navy">
            {!confirmed ? 'Create payment accounts' : result ? 'Accounts created' : 'Creating payment accounts'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!confirmed && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                This will create a virtual account for {count} student{count === 1 ? '' : 's'} who don&apos;t have one yet, so parents can pay by transfer.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setConfirmed(true)}
                  className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
                >
                  Create {count}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {creating && !error && (
            <div className="py-10 flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-mint border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-600">
                Creating... {job?.processed ?? 0}/{job?.total ?? 0}
              </p>
              <div className="w-full max-w-xs h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-mint transition-all duration-500"
                  style={{
                    width: `${job && job.total > 0 ? Math.min(100, (job.processed / job.total) * 100) : 0}%`,
                  }}
                />
              </div>
              {jobId && (
                <button
                  onClick={() => cancelJob(jobId)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Cancel
                </button>
              )}
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

          {result && result.status === 'cancelled' && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              Cancelled — <strong>{result.processed}</strong> account{result.processed === 1 ? '' : 's'} created before stopping.
            </div>
          )}

          {result && result.status === 'completed' && (
            <div className="space-y-4">
              <div className="p-4 bg-mint-light/40 border border-mint/30 rounded-xl">
                <p className="text-sm font-medium text-navy mb-2">Done</p>
                <ul className="space-y-1 text-sm text-gray-700">
                  <li><strong className="text-mint">{result.processed}</strong> account{result.processed === 1 ? '' : 's'} created</li>
                  {(result.failures?.length ?? 0) > 0 && (
                    <li className="text-amber-700">{result.failures!.length} failed — see below</li>
                  )}
                </ul>
              </div>

              {(result.failures?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                    Failed ({result.failures!.length}) — you can retry, accounts already created won&apos;t be duplicated
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
                onClick={onClose}
                className="w-full px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
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
