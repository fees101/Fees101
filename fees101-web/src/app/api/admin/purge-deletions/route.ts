import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Daily scheduled-deletion executor. For every deletion request whose grace
// window has elapsed, it archives anonymised financials + hard-deletes all
// school-scoped data (via the archive_and_delete_school SQL function), then
// deletes the school's auth users and marks the request completed. Finally it
// purges any archived financials past their retention date.
//
// DESTRUCTIVE. Protected by CRON_SECRET (Vercel cron GET) or PURGE_SECRET
// (manual POST). See vercel.json for the schedule.

interface PurgeResult {
  schoolId: string
  status: 'completed' | 'failed'
  archived?: number
  authDeleted?: number
  authFailures?: number
  error?: string
}

async function runPurge() {
  const supabase = createServiceRoleClient()
  const nowIso = new Date().toISOString()

  // Due requests: scheduled and past their grace window.
  const { data: due, error: dueErr } = await supabase
    .from('school_deletion_requests')
    .select('id, school_id, financial_purge_at')
    .eq('status', 'scheduled')
    .lte('scheduled_for', nowIso)

  if (dueErr) {
    return { error: `Failed to load due requests: ${dueErr.message}`, results: [] as PurgeResult[] }
  }

  const results: PurgeResult[] = []

  for (const req of due || []) {
    // Snapshot the auth user ids before the SQL delete removes public.users
    // (users.id == auth.users.id).
    const { data: userRows } = await supabase
      .from('users')
      .select('id')
      .eq('school_id', req.school_id)
    const authIds = (userRows || []).map(u => u.id as string)

    // Archive + hard-delete all school-scoped business data (transactional).
    const { data: archived, error: rpcErr } = await supabase.rpc('archive_and_delete_school', {
      p_school_id: req.school_id,
      p_purge_after: req.financial_purge_at,
    })

    if (rpcErr) {
      // Leave the request 'scheduled' so the next run retries; don't touch auth.
      results.push({ schoolId: req.school_id, status: 'failed', error: rpcErr.message })
      continue
    }

    // Delete the auth accounts (not covered by the SQL function).
    let authDeleted = 0
    let authFailures = 0
    for (const id of authIds) {
      const { error } = await supabase.auth.admin.deleteUser(id)
      if (error) authFailures++
      else authDeleted++
    }

    await supabase
      .from('school_deletion_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        archived_record_count: archived ?? 0,
      })
      .eq('id', req.id)

    results.push({
      schoolId: req.school_id,
      status: 'completed',
      archived: archived ?? 0,
      authDeleted,
      authFailures,
    })
  }

  // Purge archived financials past their retention date.
  const { data: purged } = await supabase.rpc('purge_expired_financials')

  return { results, financialsPurged: purged ?? 0 }
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-purge-secret')
  if (!secret || secret !== process.env.PURGE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runPurge())
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runPurge())
}
