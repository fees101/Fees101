import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { failJob, type BackgroundJob } from '@/lib/jobs/backgroundJobs'
import { advanceJob } from '@/lib/jobs/advanceJob'

// Safety net for background_jobs: a job only stays "running" without its
// updated_at moving if the tab that started it was closed, the browser
// crashed, or a network drop stopped the poll loop. This finds any such job
// older than STALL_THRESHOLD_MS and resumes it directly with a service-role
// client. advanceJob() already logs the normal invoice.generated_bulk /
// invoice.regenerated_bulk audit event on completion (attributed to the
// staff member who originally started the job) — the audit log is
// staff-actions-only by design, so the sweep itself doesn't add its own
// automated entries; a job's live status/error is readable straight off the
// background_jobs row.
//
// Protected by CRON_SECRET (Vercel cron GET, once daily via vercel.json — a
// fallback that alone could leave a job stalled up to a day on Vercel's
// free/Hobby plan) or SWEEP_SECRET (manual POST, hit every ~5 minutes by
// .github/workflows/job-sweep.yml so a job actually resumes within minutes
// without needing a paid Vercel plan for frequent cron). Same pattern as
// purge-deletions.
//
// 3 minutes comfortably clears a genuinely active tab: pollJob's slow driver
// loop completes a chunk-processing call (up to JOB_TIME_BUDGET_MS = 50s)
// and immediately re-calls /api/jobs/process, so updated_at never goes more
// than ~50s stale while a tab is actually open — no risk of the sweep and an
// active tab racing the same job.
const STALL_THRESHOLD_MS = 3 * 60 * 1000

async function runSweep() {
  const supabase = createServiceRoleClient()
  const staleBefore = new Date(Date.now() - STALL_THRESHOLD_MS).toISOString()

  const { data: stalled } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'running')
    .lt('updated_at', staleBefore)

  const results: { jobId: string; schoolId: string; outcome: string }[] = []

  for (const job of (stalled || []) as BackgroundJob[]) {
    try {
      await advanceJob(supabase, job)
      results.push({ jobId: job.id, schoolId: job.school_id, outcome: 'resumed' })
    } catch (err: any) {
      await failJob(job.id, err?.message || 'Unknown error')
      results.push({ jobId: job.id, schoolId: job.school_id, outcome: 'failed' })
    }
  }

  return { swept: results.length, results }
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-sweep-secret')
  if (!secret || secret !== process.env.SWEEP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runSweep())
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runSweep())
}
