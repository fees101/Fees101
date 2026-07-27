import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { sendDueRemindersForSchool } from '@/lib/messaging/reminders'

async function runReminders() {
  const supabase = createServiceRoleClient()

  const { data: schools } = await supabase.from('schools').select('id')

  const results = []
  for (const school of schools || []) {
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
