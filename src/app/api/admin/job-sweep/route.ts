import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { failJob, type BackgroundJob } from '@/lib/jobs/backgroundJobs'
import { advanceJob } from '@/lib/jobs/advanceJob'

// Daily safety net for background_jobs: a job only stays "running" without
// its updated_at moving if the tab that started it was closed, the browser
// crashed, or a network drop stopped the poll loop. This finds any such job
// older than 10 minutes and resumes it directly with a service-role client,
// so an abandoned job still finishes within a day instead of hanging
// forever. advanceJob() already logs the normal invoice.generated_bulk /
// invoice.regenerated_bulk audit event on completion (attributed to the
// staff member who originally started the job) — the audit log is
// staff-actions-only by design, so the sweep itself doesn't add its own
// automated entries; a job's live status/error is readable straight off the
// background_jobs row.
//
// Protected by CRON_SECRET (Vercel cron GET) or SWEEP_SECRET (manual POST),
// same pattern as purge-deletions.

const STALL_THRESHOLD_MS = 10 * 60 * 1000

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
