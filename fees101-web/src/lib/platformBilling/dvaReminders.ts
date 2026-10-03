// Email reminders for schools on the bank-transfer (DVA) billing method. A
// mandate-method school is charged automatically and only needs to know when
// a debit fails; a DVA school has to remember to transfer the money itself,
// so it needs a nudge. Rather than a new "reminder already sent" column, this
// piggybacks on the dunning ladder's own state transitions (see dunning.ts) —
// one email per transition means at most one email per escalation step, no
// daily spam, and no extra bookkeeping.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { brevo } from '@/lib/messaging/brevo'

type LadderMove = { from: string; to: string; schoolId: string }

const SUBJECT: Record<string, string> = {
  payment_due: 'Your Fees101 bill is due',
  grace: 'Your Fees101 bill is now overdue',
  suspended: 'Fees101 billing suspended — action needed',
}

function bodyFor(to: string, schoolName: string, accountNumber: string, bankName: string, amount: number): string {
  const naira = '₦' + Math.round(amount).toLocaleString('en-NG')
  if (to === 'payment_due') {
    return `Hi,\n\n${schoolName}'s monthly Fees101 bill (${naira}) is now due. Please transfer it to:\n\n` +
      `Account number: ${accountNumber}\nBank: ${bankName}\n\n` +
      `This unlocks automatically once the transfer lands.\n\nFees101`
  }
  if (to === 'grace') {
    return `Hi,\n\n${schoolName}'s Fees101 bill (${naira}) is now overdue. Please transfer it soon to avoid suspension:\n\n` +
      `Account number: ${accountNumber}\nBank: ${bankName}\n\nFees101`
  }
  return `Hi,\n\n${schoolName}'s Fees101 account has been suspended for non-payment. Transfer ${naira} to the ` +
    `account below to restore access immediately:\n\nAccount number: ${accountNumber}\nBank: ${bankName}\n\nFees101`
}

// Called with the ladder transitions a cron run just made (both the mandate
// and DVA ones). Only DVA-method schools get an email — a mandate school's
// retries are automatic and Paystack-side.
export async function sendDvaReminderEmails(moves: LadderMove[]): Promise<void> {
  const relevant = moves.filter(m => SUBJECT[m.to])
  if (relevant.length === 0) return

  const svc = createServiceRoleClient()

  for (const move of relevant) {
    const { data: billing } = await svc
      .from('platform_billing')
      .select('billing_method, mandate_email, platform_dva_account_number, platform_dva_bank_name')
      .eq('school_id', move.schoolId)
      .maybeSingle()
    if (!billing || billing.billing_method !== 'dva' || !billing.mandate_email) continue
    if (!billing.platform_dva_account_number) continue

    const { data: period } = await svc
      .from('platform_billing_periods')
      .select('amount_due, amount_paid')
      .eq('school_id', move.schoolId)
      .in('status', ['open', 'billed', 'partial', 'overdue'])
      .order('period_start', { ascending: true })
      .limit(1)
      .maybeSingle()
    const outstanding = period ? Number(period.amount_due) - Number(period.amount_paid) : 0

    const { data: school } = await svc.from('schools').select('name').eq('id', move.schoolId).maybeSingle()
    const schoolName = school?.name || 'Your school'

    await brevo.send({
      to: billing.mandate_email,
      subject: SUBJECT[move.to],
      text: bodyFor(move.to, schoolName, billing.platform_dva_account_number, billing.platform_dva_bank_name || '', outstanding),
      html: bodyFor(move.to, schoolName, billing.platform_dva_account_number, billing.platform_dva_bank_name || '', outstanding).replace(/\n/g, '<br/>'),
    })
  }
}
