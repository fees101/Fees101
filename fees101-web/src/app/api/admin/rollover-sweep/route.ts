import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { continueYearEndRolloverForSweep } from '@/app/(app)/fees/cycles/actions'

// Vercel Hobby's ceiling — a resumed run can run through several remaining
// steps (each looping over every student) in one call before hitting
// 'completed'. Config only.
export const maxDuration = 60

// Safety net for rollover_runs — the year-end equivalent of job-sweep for
// background_jobs. A run only stays 'in_progress' without its updated_at
// moving if the serverless function driving continueYearEndRollover was
// killed mid-step (maxDuration timeout) or crashed before reaching the
// catch block that would otherwise mark it 'failed'. This finds any such
// run older than STALL_THRESHOLD_MS and resumes it directly with a
// service-role client (continueYearEndRolloverForSweep ->
// continueYearEndRolloverCore in fees/cycles/actions.ts) — the same step
// machine the manual "Resume rollover" button drives.
//
// One known gap: a run stalled at step 'started' with to_cycle_id still
// null needs the new term/session details typed into the wizard, which are
// never persisted server-side. continueYearEndRolloverForSweep always calls
// through with no newTerm, so that specific case surfaces the same "New
// term details are required" error and the row is left untouched
// (in_progress, unresumed) for a human to finish via the wizard. Every
// later step (cycle_created / promoted / adjustments_carried) only touches
// already-persisted DB state and resumes fully automatically — those are
// also the expensive per-student-loop steps most likely to actually stall.
//
// updated_at + the two indexes this relies on come from
// db/rollover_runs_updated_at.sql — NOT YET RUN. Run it in the Supabase SQL
// editor before this route (or its cron entries) can do anything useful;
// until then rollover_runs.updated_at doesn't exist and every query below
// errors, so the sweep is a harmless no-op-with-error rather than a risk.
//
// Protected by CRON_SECRET (Vercel cron GET, once daily via vercel.json) or
// SWEEP_SECRET (manual POST, hit every ~5 minutes by
// .github/workflows/job-sweep.yml so a stalled rollover resumes within
// minutes instead of waiting up to a day). Same pattern as job-sweep and
// purge-deletions.
const STALL_THRESHOLD_MS = 3 * 60 * 1000

async function runSweep() {
  const supabase = createServiceRoleClient()
  const staleBefore = new Date(Date.now() - STALL_THRESHOLD_MS).toISOString()

  const { data: stalled } = await supabase
    .from('rollover_runs')
    .select('id, school_id')
    .eq('status', 'in_progress')
    .lt('updated_at', staleBefore)

  const results: { runId: string; schoolId: string; outcome: string }[] = []

  for (const run of stalled || []) {
    try {
      const result = await continueYearEndRolloverForSweep(run.id)
      const outcome = 'error' in result
        ? (result.error === 'New term details are required to start the rollover' ? 'needs-manual-input' : 'failed')
        : 'resumed'
      results.push({ runId: run.id, schoolId: run.school_id, outcome })
    } catch (err: any) {
      results.push({ runId: run.id, schoolId: run.school_id, outcome: 'error' })
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
