import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Shared helpers for the background_jobs table (db/background_jobs.sql).
// A "job" tracks one long-running, chunkable piece of work (invoice
// generation, CSV import, bulk DVA creation) so it survives a closed tab or a
// serverless timeout instead of losing progress held only in client state.
// All writes go through the service-role client — see db/background_jobs.sql
// for why the table has no client-facing INSERT/UPDATE policy.

export type JobType = 'invoice_generation' | 'invoice_regeneration' | 'csv_import' | 'bulk_dva'
export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface JobFailure {
  label: string
  error: string
}

export interface BackgroundJob {
  id: string
  school_id: string
  job_type: JobType
  status: JobStatus
  payload: Record<string, unknown>
  cursor: Record<string, unknown>
  total: number
  processed: number
  failed: number
  failures: JobFailure[]
  error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function createJob(params: {
  schoolId: string
  jobType: JobType
  payload: Record<string, unknown>
  total: number
  createdBy: string
}): Promise<BackgroundJob> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('background_jobs')
    .insert({
      school_id: params.schoolId,
      job_type: params.jobType,
      payload: params.payload,
      total: params.total,
      created_by: params.createdBy,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Failed to create background job')
  return data as BackgroundJob
}

export async function getJob(jobId: string): Promise<BackgroundJob | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase.from('background_jobs').select('*').eq('id', jobId).maybeSingle()
  return (data as BackgroundJob) ?? null
}

// Find a still-running job of this type for the school (so a page reload can
// resume polling instead of starting a duplicate job). Excludes jobs whose
// updated_at is older than the sweep's own stall threshold — an abandoned job
// (crashed tab, dropped connection) sits at status 'running' forever until
// something sweeps it, and in local dev nothing ever does (job-sweep only
// fires from Vercel's cron or a manual/GitHub Actions call, neither of which
// runs against a dev server) — so without this, a dead job from days ago
// would get handed back as "still active" indefinitely and its frozen
// numbers would be all a user ever sees.
const STALE_JOB_MS = 3 * 60 * 1000

export async function findRunningJob(schoolId: string, jobType: JobType, payloadFilter?: Record<string, unknown>): Promise<BackgroundJob | null> {
  const supabase = createServiceRoleClient()
  const staleBefore = new Date(Date.now() - STALE_JOB_MS).toISOString()
  const query = supabase
    .from('background_jobs')
    .select('*')
    .eq('school_id', schoolId)
    .eq('job_type', jobType)
    .eq('status', 'running')
    .gte('updated_at', staleBefore)
    .order('created_at', { ascending: false })
    .limit(1)

  const { data } = await query
  const job = (data?.[0] as BackgroundJob) ?? null
  if (!job) return null
  if (payloadFilter && !Object.entries(payloadFilter).every(([k, v]) => job.payload[k] === v)) return null
  return job
}

export async function updateJobProgress(jobId: string, patch: {
  cursor?: Record<string, unknown>
  processed?: number
  failed?: number
  failures?: JobFailure[]
}): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase
    .from('background_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

export async function completeJob(jobId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase
    .from('background_jobs')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

export async function failJob(jobId: string, error: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase
    .from('background_jobs')
    .update({ status: 'failed', error, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

// Wall-clock budget per worker-route invocation, safely under Vercel's
// default serverless maxDuration. Keeps a single call processing chunks in a
// loop instead of returning after just one, while leaving enough margin to
// finish updating the job row before the function is killed.
export const JOB_TIME_BUDGET_MS = 50_000
