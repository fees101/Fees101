import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { deactivateMandate, deactivatePlatformDva } from '@/lib/platformBilling/paystack'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'

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
  dvasClosed?: number
  dvaFailures?: number
  error?: string
}

// Parents can otherwise keep transferring into a school's dedicated accounts
// forever: archive_and_delete_school hard-deletes the local
// provider_dva_reference columns, but never closes the accounts at the
// provider, so they're orphaned (open, reachable, unmonitored) rather than
// gone. Must run BEFORE the RPC below, which deletes the schools row the
// provider credentials live on. A failure to close any one DVA must not
// block the deletion itself — it's logged and left for manual cleanup, same
// as the mandate-deactivate step already does.
async function closeSchoolDvas(
  supabase: ReturnType<typeof createServiceRoleClient>,
  schoolId: string
): Promise<{ closed: number; failed: number }> {
  let closed = 0
  let failed = 0

  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (provider) {
    const [{ data: families }, { data: students }] = await Promise.all([
      supabase.from('families').select('provider_dva_reference').eq('school_id', schoolId).not('provider_dva_reference', 'is', null),
      supabase.from('students').select('provider_dva_reference').eq('school_id', schoolId).not('provider_dva_reference', 'is', null),
    ])
    const references = [...(families || []), ...(students || [])].map(r => r.provider_dva_reference as string)

    for (const reference of references) {
      try {
        await provider.deleteDVA(reference)
        closed++
      } catch (err) {
        failed++
        console.error(`Failed to close DVA ${reference} for school ${schoolId}:`, err)
      }
    }
  }

  // The Fees101-owned platform DVA (the school's OWN bill into Fees101, not a
  // parent-facing one) lives on platform_billing and uses the platform's own
  // Paystack account — separate from the per-school provider above, and
  // missed entirely if only families/students are checked.
  const { data: billing } = await supabase
    .from('platform_billing')
    .select('platform_dva_reference')
    .eq('school_id', schoolId)
    .maybeSingle()
  if (billing?.platform_dva_reference) {
    try {
      await deactivatePlatformDva(billing.platform_dva_reference)
      closed++
    } catch (err) {
      failed++
      console.error(`Failed to close platform DVA for school ${schoolId}:`, err)
    }
  }

  return { closed, failed }
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

    // platform_billing cascades on the schools row's delete below, so the
    // mandate record is gone the instant the RPC returns — deactivate it at
    // Paystack now, while we can still read the authorization code. A failure
    // here must not block the deletion itself (the school is leaving either
    // way); it's logged and left for manual cleanup.
    const { data: billing } = await supabase
      .from('platform_billing')
      .select('mandate_authorization_code')
      .eq('school_id', req.school_id)
      .maybeSingle()
    if (billing?.mandate_authorization_code) {
      try {
        await deactivateMandate(billing.mandate_authorization_code)
      } catch (err) {
        console.error(`Failed to deactivate mandate for school ${req.school_id}:`, err)
      }
    }

    const { closed: dvasClosed, failed: dvaFailures } = await closeSchoolDvas(supabase, req.school_id)

    // Archive + hard-delete all school-scoped business data (transactional).
    const { data: archived, error: rpcErr } = await supabase.rpc('archive_and_delete_school', {
      p_school_id: req.school_id,
      p_purge_after: req.financial_purge_at,
    })

    if (rpcErr) {
      // A prior run can crash after the RPC succeeds but before the request
      // is marked 'completed' below, leaving it 'scheduled' forever — retrying
      // archive_and_delete_school on an already-gone school just raises this
      // same "not found" error every time. Treat it as already done rather
      // than a failure so the request isn't stuck retrying indefinitely.
      if (/school .* not found/i.test(rpcErr.message)) {
        await supabase
          .from('school_deletion_requests')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', req.id)
        results.push({ schoolId: req.school_id, status: 'completed', archived: 0, authDeleted: 0, authFailures: 0 })
        continue
      }
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
      dvasClosed,
      dvaFailures,
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
