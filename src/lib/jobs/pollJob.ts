// Client-side helper for the "start job, then poll" pattern: repeatedly calls
// the worker route until the job leaves "running". Each call already
// processes a full chunk-loop server-side (see JOB_TIME_BUDGET_MS), so this
// loop is just driving that forward and reading progress after each hop —
// not a passive status check.
export async function pollJob(
  jobId: string,
  onProgress?: (status: { status: string; processed: number; total: number; failed?: number }) => void
): Promise<{ status: string; processed: number; total: number; failed?: number; failures?: { label: string; error: string }[]; error?: string }> {
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
}
