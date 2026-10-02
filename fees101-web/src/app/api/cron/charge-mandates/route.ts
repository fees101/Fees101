import { NextRequest, NextResponse } from 'next/server'
import { runMonthlyDebits } from '@/lib/platformBilling/recurringDebit'
import { evaluateAllLadders } from '@/lib/platformBilling/dunning'

// Recurring platform-billing cron. Runs the monthly direct-debits and then walks
// the dunning ladder. Safe to run DAILY: the debit is idempotent per billing
// period (a period with a pending/successful charge is skipped), and the ladder
// only writes on an actual status transition. Running daily means failed debits
// get retried and overdue schools escalate promptly.
//
// Auth matches the console accrue-usage cron: a shared secret in
// PLATFORM_BILLING_CRON_SECRET, accepted via the x-billing-secret header, a
// ?secret= query param, or an Authorization: Bearer header, so any simple
// scheduler can trigger it. No user session.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.PLATFORM_BILLING_CRON_SECRET
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

  const now = new Date()
  const debits = await runMonthlyDebits(now)
  const ladderMoves = await evaluateAllLadders(now)

  return NextResponse.json({
    ok: true,
    date: now.toISOString().slice(0, 10),
    debits,
    ladderMoves,
  })
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
