import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getJob, type JobType } from '@/lib/jobs/backgroundJobs'

// Cheap, read-only status check for a background_jobs row — no advancing.
// Polled on a fast interval (src/lib/jobs/pollJob.ts) alongside the slow
// /api/jobs/process call so the UI can tick up progress every couple of
// seconds instead of only once per (up to 50s) processing round-trip.

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

  return NextResponse.json({
    status: job.status,
    processed: job.processed,
    total: job.total,
    failed: job.failed,
    failures: job.failures,
    error: job.error,
  })
}
