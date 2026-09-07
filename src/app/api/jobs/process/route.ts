import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getJob, failJob, type JobType } from '@/lib/jobs/backgroundJobs'
import { advanceJob } from '@/lib/jobs/advanceJob'

// Authenticated worker route for background_jobs (db/background_jobs.sql).
// Called by the client right after starting a job, then again on every poll
// tick (src/lib/jobs/pollJob.ts) — each call advances the job by as many
// chunks as fit in JOB_TIME_BUDGET_MS and returns its fresh status, so the
// client keeps polling while status stays 'running'. Auth is a normal
// session + permission check (not a shared secret) since this is a
// user-facing continuation call, not service-to-service — the daily sweep
// (src/app/api/admin/job-sweep) calls advanceJob() directly instead with a
// service-role client.

const JOB_PERMISSION: Record<JobType, string> = {
  invoice_generation: 'manage-invoices',
  invoice_regeneration: 'manage-invoices',
  csv_import: 'manage-students',
  bulk_dva: 'manage-payment-config',
}

export async function POST(request: NextRequest) {
  const { jobId } = await request.json()
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const job = await getJob(jobId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const ctx = await getAuthContext()
  if (!ctx || ctx.schoolId !== job.school_id || !can(ctx, JOB_PERMISSION[job.job_type])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (job.status === 'running') {
    try {
      const supabase = createServiceRoleClient()
      await advanceJob(supabase, job)
    } catch (err: any) {
      await failJob(jobId, err?.message || 'Unknown error')
    }
  }

  const updated = await getJob(jobId)
  if (!updated) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({
    status: updated.status,
    processed: updated.processed,
    total: updated.total,
    failed: updated.failed,
    failures: updated.failures,
    error: updated.error,
  })
}
