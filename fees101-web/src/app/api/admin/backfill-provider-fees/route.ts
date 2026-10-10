import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { createJob, findRunningJob, failJob, type BackgroundJob } from '@/lib/jobs/backgroundJobs'
import { advanceJob } from '@/lib/jobs/advanceJob'
import { findProviderFeeGaps } from '@/lib/payments/backfillProviderFees'

// One-time (re-runnable/idempotent) historical backfill for
// payments.provider_fee — see src/lib/payments/backfillProviderFees.ts for
// the full "why". Every school with a configured provider gets its own
// background_jobs row (job_type 'provider_fee_backfill', requires
// db/add_provider_fee_backfill_job_type.sql to have been run), same
// per-school scoping as bulk DVA creation since verifying a transaction needs
// that school's own decrypted provider credentials.
//
// Not a cron/webhook-adjacent route — this is a manual, admin-triggered
// cleanup for rows that predate live fee capture, not an ongoing process (new
// payments already get their real provider_fee at webhook time). Run it with:
//
//   curl -X POST https://<app>/api/admin/backfill-provider-fees \
//     -H "x-backfill-secret: $PROVIDER_FEE_BACKFILL_SECRET"
//
// Safe to re-run: findProviderFeeGaps() only ever returns transactions with
// zero fee captured anywhere among their payments rows, and the per-row
// update is itself guarded with .is('provider_fee', null), so a repeat call
// (or an overlapping one) can only ever fill a gap once, never overwrite a
// real value. A transaction that comes back "not found at provider" (e.g. a
// pre-launch test/synthetic reference that was never a real charge) is
// recorded in that run's `failures` and simply stays a gap — there is nothing
// further to retry for those specific references.
async function runBackfill() {
  const supabase = createServiceRoleClient()
  const { data: schools } = await supabase
    .from('schools')
    .select('id, name')
    .in('payment_provider', ['monnify', 'paystack'])

  const results: {
    schoolId: string
    schoolName: string
    gapsFound: number
    jobId?: string
    status?: string
    processed?: number
    failed?: number
    failures?: { label: string; error: string }[]
  }[] = []

  for (const school of schools || []) {
    const gaps = await findProviderFeeGaps(supabase, school.id)
    if (gaps.length === 0) {
      results.push({ schoolId: school.id, schoolName: school.name, gapsFound: 0 })
      continue
    }

    let job = await findRunningJob(school.id, 'provider_fee_backfill')
    if (!job) {
      job = await createJob({
        schoolId: school.id,
        jobType: 'provider_fee_backfill',
        payload: {},
        total: gaps.length,
        createdBy: null,
        cursor: { groups: gaps },
      })
    }

    try {
      await advanceJob(supabase, job)
    } catch (err: any) {
      await failJob(job.id, err?.message || 'Unknown error')
    }

    const { data: refreshed } = await supabase
      .from('background_jobs')
      .select('*')
      .eq('id', job.id)
      .single()

    const finished = (refreshed || job) as BackgroundJob
    results.push({
      schoolId: school.id,
      schoolName: school.name,
      gapsFound: gaps.length,
      jobId: finished.id,
      status: finished.status,
      processed: finished.processed,
      failed: finished.failed,
      failures: finished.failures,
    })
  }

  return results
}

// No user session applies here (platform-owner tool, not a school staff
// action) — shared-secret protected, same pattern as /api/admin/reconcile.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-backfill-secret')
  if (!secret || secret !== process.env.PROVIDER_FEE_BACKFILL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json({ results: await runBackfill() })
  } catch (err: any) {
    // A bare 500 with no body here is indistinguishable from "the whole app
    // is down" — this is an admin-only diagnostic tool, so surface the real
    // reason instead of making whoever's running it dig through server logs.
    return NextResponse.json({ error: err?.message || 'Unknown error', stack: err?.stack }, { status: 500 })
  }
}
