import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { sendDueRemindersForSchool } from '@/lib/messaging/reminders'

async function runReminders() {
  const supabase = createServiceRoleClient()

  const { data: schools } = await supabase.from('schools').select('id')

  // Skip schools that have closed their account (scheduled for deletion) — they
  // shouldn't keep sending parents payment reminders during the grace window.
  const { data: closing } = await supabase
    .from('school_deletion_requests')
    .select('school_id')
    .eq('status', 'scheduled')
  const closingIds = new Set((closing || []).map(r => r.school_id as string))

  const results = []
  for (const school of schools || []) {
    if (closingIds.has(school.id)) continue
    results.push(await sendDueRemindersForSchool(school.id, supabase))
  }

  return results
}

// Manual/local trigger — same pattern as /api/admin/reconcile's POST.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-reminders-secret')
  if (!secret || secret !== process.env.REMINDERS_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ results: await runReminders() })
}

// Vercel Cron invokes with GET and sends the project's CRON_SECRET env var
// as a bearer token automatically once it's set — see vercel.json for the
// schedule.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ results: await runReminders() })
}
