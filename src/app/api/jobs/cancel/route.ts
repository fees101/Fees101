import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getJob, cancelJob, type JobType } from '@/lib/jobs/backgroundJobs'

// User-initiated stop for a running background_jobs row. Same auth shape as
// /api/jobs/process (session + permission, not a shared secret) since this is
// a user-facing action, gated by the same permission that started the job.
// Cancellation only takes effect between chunks — see updateJobProgress's own
// status check in backgroundJobs.ts — so a chunk already in flight still
// finishes before the job actually stops.

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

  const cancelled = await cancelJob(jobId)

  const updated = await getJob(jobId)
  if (!updated) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({
    cancelled,
    status: updated.status,
    processed: updated.processed,
    total: updated.total,
    failed: updated.failed,
    failures: updated.failures,
    error: updated.error,
  })
}
