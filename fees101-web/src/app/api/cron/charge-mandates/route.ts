import { NextRequest, NextResponse } from 'next/server'
import { runMonthlyDebits, runDvaDueChecks } from '@/lib/platformBilling/recurringDebit'
import { evaluateAllLadders } from '@/lib/platformBilling/dunning'
import { sendDvaReminderEmails } from '@/lib/platformBilling/dvaReminders'
import { sendMandateReminderSms } from '@/lib/platformBilling/mandateReminders'
import { pollPlatformDvaTransfers } from '@/lib/platformBilling/dvaPoll'
import { remindDvaSchoolsToSwitch } from '@/lib/platformBilling/dvaSwitchReminder'

// Recurring platform-billing cron. Runs the monthly direct-debits and then walks
// the dunning ladder. Safe to run DAILY: the debit is idempotent per billing
// period (a period with a pending/successful charge is skipped), and the ladder
// only writes on an actual status transition. Running daily means failed debits
// get retried and overdue schools escalate promptly.
//
// Auth: a shared secret in PLATFORM_BILLING_CRON_SECRET, accepted via the
// x-billing-secret header, a ?secret= query param, or an Authorization: Bearer
// header, so any simple scheduler can trigger it manually. Vercel Cron (see
// vercel.json) invokes with GET and sends the project's CRON_SECRET env var as
// a bearer token automatically once it's set, same as the other /api/admin
// crons in this app — accepted here too so no extra secret has to be managed.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.PLATFORM_BILLING_CRON_SECRET

  const headerSecret = req.headers.get('x-billing-secret')
  const querySecret = req.nextUrl.searchParams.get('secret')
  const authHeader = req.headers.get('authorization')
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (expected && (headerSecret === expected || querySecret === expected || bearerSecret === expected)) {
    return true
  }
  return Boolean(process.env.CRON_SECRET) && bearerSecret === process.env.CRON_SECRET
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const debits = await runMonthlyDebits(now)
  const dvaDue = await runDvaDueChecks(now)
  // Backstop for a missed/lost platform-DVA webhook delivery — re-check
  // Paystack directly before the ladder evaluates, so a school that already
  // paid doesn't get escalated on stale status.
  const dvaPolled = await pollPlatformDvaTransfers()
  const ladderMoves = await evaluateAllLadders(now)
  await sendDvaReminderEmails(ladderMoves)
  await sendMandateReminderSms(ladderMoves)
  const dvaSwitchReminders = await remindDvaSchoolsToSwitch(now)

  return NextResponse.json({
    ok: true,
    date: now.toISOString().slice(0, 10),
    debits,
    dvaDue,
    dvaPolled,
    ladderMoves,
    dvaSwitchReminders,
  })
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
