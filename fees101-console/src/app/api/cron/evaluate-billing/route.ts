import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { evaluateSuspensionLadder } from '@/lib/billing'

// Same pattern as the schools-facing app's cron routes (reconcile, reminders):
// a shared secret in a header, no user session, meant to be called on a
// schedule (GitHub Actions / Vercel cron) rather than clicked by a person.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-billing-secret')
  if (!secret || secret !== process.env.BILLING_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const { data: rows } = await supabase.from('platform_billing').select('school_id')

  const changes: { schoolId: string; from: string; to: string }[] = []
  for (const row of rows || []) {
    const result = await evaluateSuspensionLadder(row.school_id)
    if (result) changes.push({ schoolId: row.school_id, ...result })
  }

  return NextResponse.json({ checked: rows?.length || 0, changes })
}
