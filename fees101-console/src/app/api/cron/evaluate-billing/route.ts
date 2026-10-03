import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { evaluateSuspensionLadder } from '@/lib/billing'

// Same pattern as the schools-facing app's cron routes (reconcile, reminders):
// a shared secret in a header, no user session, meant to be called on a
// schedule (Vercel cron) rather than clicked by a person.
async function run() {
  const supabase = createServiceRoleClient()
  const { data: rows } = await supabase.from('platform_billing').select('school_id')

  const changes: { schoolId: string; from: string; to: string }[] = []
  for (const row of rows || []) {
    const result = await evaluateSuspensionLadder(row.school_id)
    if (result) changes.push({ schoolId: row.school_id, ...result })
  }

  return NextResponse.json({ checked: rows?.length || 0, changes })
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-billing-secret')
  if (!secret || secret !== process.env.BILLING_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

// Vercel Cron (see vercel.json) invokes with GET and sends the project's
// CRON_SECRET env var as a bearer token automatically once it's set.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}
