// Reconciliation for money that left a school's provider balance WITHOUT
// going through Fees101 at all — a refund made directly on the provider's own
// dashboard, or (Paystack only) a lost chargeback/card-dispute. Shared by both
// providers' webhook processors (Paystack's refund.processed with no matching
// `refunds` row and a resolved dispute that went against the school; Monnify's
// refund-completed event with no matching row) since the detect-and-record
// shape is identical: find the original payment(s) by provider_transaction_id,
// prorate the loss across any split rows (one charge can fund more than one
// invoice), write one 'pending' `refunds` row per split tagged
// `initiated_externally`, and raise one Needs-you alert.
//
// Deliberately does NOT write the ledger adjustment here — that only happens
// when a human clicks Confirm in the Refunds workspace
// (confirm_external_refund RPC, src/app/(app)/money/refunds/actions.ts). A
// webhook guessing wrong about which invoice to touch, unattended, would be
// its own new failure mode; this only ever gets the books in front of a
// person who can see the real reference and amount.
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

type Supa = ReturnType<typeof createServiceRoleClient>

export async function recordExternalMoneyLoss(
  supabase: Supa,
  schoolId: string,
  transactionReference: string | undefined,
  lostAmountNaira: number,
  method: 'paystack_reversal' | 'monnify_reversal' | 'chargeback',
  // The provider's own id for the event that caused this — a refund id for
  // refund.processed/the Monnify refund-completed equivalent, a dispute id
  // for a resolved Paystack dispute. Reused as the dedupe key (either
  // provider can redeliver the same webhook) even though the column is
  // named for the Paystack refund case — Monnify's refund reference is
  // stored here too, same convention refundTransaction()/verifyRefund()
  // already follow on MonnifyProvider.
  externalEventId: string | undefined,
): Promise<void> {
  if (!(lostAmountNaira > 0)) return

  const providerLabel = method === 'monnify_reversal' ? 'Monnify' : 'Paystack'

  if (externalEventId) {
    // Thrown (not swallowed) on a lookup failure — the caller's try/catch
    // turns this into a webhook error response so Paystack redelivers, rather
    // than this risking a duplicate refunds row by treating "couldn't check"
    // the same as "not a duplicate" on a later retry.
    const { data: already, error: dedupeError } = await supabase
      .from('refunds')
      .select('id')
      .eq('school_id', schoolId)
      .eq('paystack_refund_id', externalEventId)
      .limit(1)
    if (dedupeError) throw dedupeError
    if (already && already.length > 0) return // already recorded — a redelivered webhook, not a new event
  }

  const lostAmount = Math.round(lostAmountNaira)
  const noun = method === 'chargeback' ? 'was taken back via a card dispute' : 'was refunded'
  const title = method === 'chargeback' ? 'A chargeback happened on Paystack' : `A refund happened on ${providerLabel}`

  let splits: { id: string; student_id: string; invoice_id: string | null; amount: number }[] = []
  if (transactionReference) {
    const { data: paymentRows, error: paymentsError } = await supabase
      .from('payments')
      .select('id, student_id, invoice_id, amount')
      .eq('school_id', schoolId)
      .eq('provider_transaction_id', transactionReference)
      .gt('amount', 0)
    if (paymentsError) throw paymentsError
    splits = paymentRows || []
  }

  if (splits.length === 0) {
    // No record of this transaction at all (predates Fees101, or an
    // unrelated use of the same Paystack account for something else) — no
    // payment to attach a refunds row to, but still worth a bare alert so
    // the money loss doesn't vanish without a trace.
    const { error: bareNotifyError } = await supabase.from('admin_notifications').insert({
      school_id: schoolId,
      type: 'external_refund_detected',
      title,
      body: `${providerLabel} reports ₦${lostAmount.toLocaleString()} ${noun}` +
        (transactionReference ? ` on transaction ${transactionReference}` : '') +
        `, but no matching payment was found in Fees101 — review on ${providerLabel} directly.`,
    })
    if (bareNotifyError) throw bareNotifyError
    return
  }

  const totalOriginal = splits.reduce((sum, s) => sum + Number(s.amount), 0)
  const reason = method === 'chargeback'
    ? 'Detected via Paystack webhook — a card dispute was resolved against the school, outside Fees101.'
    : `Detected via ${providerLabel} webhook — refunded directly on ${providerLabel}, not through Fees101.`
  const requestedByName = method === 'chargeback'
    ? 'Paystack (card dispute, outside Fees101)'
    : `${providerLabel} (outside Fees101)`

  let remaining = lostAmount
  const inserts: Record<string, unknown>[] = []
  splits.forEach((s, i) => {
    const isLast = i === splits.length - 1
    const share = isLast ? remaining : Math.round((Number(s.amount) / totalOriginal) * lostAmount)
    remaining -= share
    if (share <= 0) return
    inserts.push({
      school_id: schoolId,
      payment_id: s.id,
      student_id: s.student_id,
      invoice_id: s.invoice_id,
      amount: share,
      category: 'other',
      reason,
      refund_method: method,
      status: 'pending',
      initiated_externally: true,
      requested_by: null,
      requested_by_name: requestedByName,
      paystack_refund_id: externalEventId || null,
    })
  })
  if (inserts.length === 0) return

  // Both inserts below are thrown (not swallowed) on failure — same reasoning
  // as the dedupe check above. Silently eating either error here looked
  // exactly like "handled" (webhook marked 'processed', 200 back to
  // Paystack) while actually losing the detection entirely: no refunds row,
  // no alert, no record this ever happened. Throwing lets the caller's
  // try/catch turn it into a webhook error response so Paystack redelivers.
  const { error: insertRefundsError } = await supabase.from('refunds').insert(inserts)
  if (insertRefundsError) throw insertRefundsError

  const { error: notifyError } = await supabase.from('admin_notifications').insert({
    school_id: schoolId,
    type: 'external_refund_detected',
    title,
    body: `₦${lostAmount.toLocaleString()} ${noun} directly on ${providerLabel}, outside Fees101. ` +
      `Review and confirm in Refunds so your records match.`,
    student_id: splits[0].student_id,
    amount: lostAmount,
  })
  if (notifyError) throw notifyError
}
