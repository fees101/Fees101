import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getJob, acknowledgeJob, type JobType } from '@/lib/jobs/backgroundJobs'

// Dismisses the "this job didn't finish" notice shown on layout load for a
// failed/interrupted job (see (app)/layout.tsx). Same auth shape as
// /api/jobs/cancel — session + the permission that started this job type.

const JOB_PERMISSION: Record<JobType, string> = {
  invoice_generation: 'manage-invoices',
  invoice_regeneration: 'manage-invoices',
  csv_import: 'manage-students',
  bulk_dva: 'manage-payment-config',
  bulk_send: 'manage-invoices',
  close_term: 'manage-fee-structure',
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

  await acknowledgeJob(jobId)
  return NextResponse.json({ acknowledged: true })
}
