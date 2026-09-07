// Client-side helper for the "start job, then poll" pattern. Two things run
// concurrently here:
//  - the slow driver: repeatedly calls /api/jobs/process, which processes a
//    full chunk-loop server-side (see JOB_TIME_BUDGET_MS, up to 50s per call)
//    and is what actually advances the job.
//  - a fast, cheap status reader (/api/jobs/status) polled every 1.5s so the
//    UI can tick the progress number up while a slow driver call is still in
//    flight, instead of only updating once per (up to 50s) driver round-trip.
export async function pollJob(
  jobId: string,
  onProgress?: (status: { status: string; processed: number; total: number; failed?: number }) => void
): Promise<{ status: string; processed: number; total: number; failed?: number; failures?: { label: string; error: string }[]; error?: string }> {
  let stopped = false
  const statusInterval = setInterval(async () => {
    if (stopped) return
    try {
      const res = await fetch('/api/jobs/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      if (!res.ok) return
      const data = await res.json()
      onProgress?.(data)
    } catch {
      // fast reader is best-effort — the driver loop below is what matters
    }
  }, 1500)

  try {
    while (true) {
      const res = await fetch('/api/jobs/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', processed: 0, total: 0, error: data.error || 'Job failed' }
      onProgress?.(data)
      if (data.status !== 'running') return data
    }
  } finally {
    stopped = true
    clearInterval(statusInterval)
  }
}
