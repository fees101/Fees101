// SMS nudges for schools on the direct-debit (mandate) billing method. A
// mandate school is charged automatically every day (recurringDebit.ts) and
// doesn't need to be told to go transfer money, unlike a DVA school
// (dvaReminders.ts), but it still needs to know its card/bank is failing,
// especially once RETRY_CAP_DAYS is reached and the automatic retries stop.
// One SMS per dunning-ladder transition (payment_due / grace / suspended),
// not one per daily retry, a message for every failed attempt would be
// spam and a real cost for no benefit. Piggybacks on the same ladder moves
// as dvaReminders.ts for the same reason: a transition only happens once, so
// there's no extra "already sent" bookkeeping needed.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { sendchamp } from '@/lib/messaging/sendchamp'
import { normalizePhone } from '@/lib/messaging/sendMessage'

type LadderMove = { from: string; to: string; schoolId: string }

// Deliberately no amount here: a figure lets an owner judge "small enough to
// ignore" without logging in, or transfer blind from memory of an old
// balance. Forcing a login to see the number also puts them on the page that
// has the actual fix (reconnect payment method), not just a bank transfer.
function textFor(to: string, schoolName: string): string {
  if (to === 'payment_due') {
    return `Fees101: ${schoolName}'s bill is due. We'll keep retrying your card/bank automatically, log in for details, no action needed unless it keeps failing.`
  }
  if (to === 'grace') {
    return `Fees101: ${schoolName}'s bill is still unpaid and overdue. Log in for details, access will be suspended soon if it doesn't clear.`
  }
  return `Fees101: ${schoolName}'s account is suspended for non-payment. Log in to pay by transfer or reconnect your payment method.`
}

// Called with the ladder transitions a cron run just made. Only mandate-
// method schools get an SMS here; DVA schools get the email in
// dvaReminders.ts instead.
export async function sendMandateReminderSms(moves: LadderMove[]): Promise<void> {
  const relevant = moves.filter(m => m.to === 'payment_due' || m.to === 'grace' || m.to === 'suspended')
  if (relevant.length === 0) return

  const svc = createServiceRoleClient()

  for (const move of relevant) {
    const { data: billing } = await svc
      .from('platform_billing')
      .select('billing_method')
      .eq('school_id', move.schoolId)
      .maybeSingle()
    if (!billing || billing.billing_method === 'dva') continue

    const [{ data: owner }, { data: school }] = await Promise.all([
      svc
        .from('users')
        .select('phone')
        .eq('school_id', move.schoolId)
        .eq('role', 'school_admin')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      svc.from('schools').select('name').eq('id', move.schoolId).maybeSingle(),
    ])
    if (!owner?.phone) continue

    await sendchamp.send({
      to: normalizePhone(owner.phone),
      text: textFor(move.to, school?.name || 'Your school'),
      channel: 'sms',
    })
  }
}
