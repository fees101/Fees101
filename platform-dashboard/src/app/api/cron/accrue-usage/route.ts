import { NextRequest, NextResponse } from 'next/server'
import { snapshotDailyUsage } from '@/lib/accrual'

// Daily accrual cron. Matches the auth pattern of the sibling cron route
// (src/app/api/cron/evaluate-billing/route.ts): a shared secret compared
// against process.env.BILLING_CRON_SECRET, no user session, meant to be called
// on a schedule rather than clicked by a person.
//
// evaluate-billing reads it from the `x-billing-secret` header; that's the
// primary here too. A `?secret=` query param and an `Authorization: Bearer`
// header are also accepted so a plain GET-based scheduler can hit it.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.BILLING_CRON_SECRET
  if (!expected) return false

  const headerSecret = req.headers.get('x-billing-secret')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const authHeader = req.headers.get('authorization')
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  return headerSecret === expected || querySecret === expected || bearerSecret === expected
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Snapshot today's usage off the SERVER date (anti-gaming — never a
  // school-supplied date).
  const { schoolsProcessed } = await snapshotDailyUsage()
  return NextResponse.json({ ok: true, schoolsProcessed, date: new Date().toISOString().slice(0, 10) })
}

export async function POST(req: NextRequest) {
  return handle(req)
}

// GET is supported too so a simple scheduler (or a manual check) can trigger it.
export async function GET(req: NextRequest) {
  return handle(req)
}
