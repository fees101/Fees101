// Backup to webhooks: polls the provider directly for each student's (and
// each family's) DVA transaction history and applies anything that never
// arrived as a webhook (delivery failure, misconfigured URL, an outage on
// either side). Reuses the exact same claim-then-cascade path the webhook
// uses — reconciliation's only real job is discovering what was missed, not
// reprocessing differently. Safe to run repeatedly: already-applied
// transactions are skipped via the same processed_provider_transactions claim.

import { getPaymentProviderForSchool } from './getProvider'
import { applyProviderPayment } from './applyPayment'
import { expireStaleTerminalRequests } from './terminal'

export interface ReconcileResult {
  schoolId: string
  studentsChecked: number
  familiesChecked: number
  transactionsChecked: number
  applied: number
  terminalRequestsExpired: number
  errors: string[]
}

export async function reconcileSchool(schoolId: string, supabase: any): Promise<ReconcileResult> {
  const result: ReconcileResult = { schoolId, studentsChecked: 0, familiesChecked: 0, transactionsChecked: 0, applied: 0, terminalRequestsExpired: 0, errors: [] }

  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) {
    result.errors.push('No payment provider configured for this school')
    return result
  }

  // Expire any in-person terminal charges that were pushed but never completed
  // (parent walked away, device went offline) so their rows don't sit "waiting"
  // forever. Independent of the DVA sweep below — runs even if there are no DVAs.
  try {
    result.terminalRequestsExpired = await expireStaleTerminalRequests(schoolId, supabase)
  } catch (err: any) {
    result.errors.push(`terminal expiry sweep failed: ${err?.message || 'unknown error'}`)
  }

  const { data: students } = await supabase
    .from('students')
    .select('id, provider_dva_reference')
    .eq('school_id', schoolId)
    .not('provider_dva_reference', 'is', null)

  for (const student of students || []) {
    result.studentsChecked++

    const transactions = await provider.listDVATransactions(student.provider_dva_reference)

    for (const tx of transactions) {
      result.transactionsChecked++
      if (tx.paymentStatus !== 'PAID') continue

      // Claim first, same as the webhook path — an insert-and-catch here is
      // what actually prevents double-applying, not this loop's own logic.
      const { error: claimError } = await supabase
        .from('processed_provider_transactions')
        .insert({ school_id: schoolId, provider: provider.name, provider_transaction_id: tx.transactionReference })

      if (claimError) {
        if (claimError.code === '23505') continue // already handled, by webhook or an earlier reconcile run
        result.errors.push(`claim failed for ${tx.transactionReference}: ${claimError.message}`)
        continue
      }

      // Re-verify against the canonical endpoint rather than trusting the
      // list summary for amounts — listDVATransactions only gives enough to
      // spot candidates.
      const verified = await provider.verifyTransaction(tx.transactionReference)
      if (!verified) {
        result.errors.push(`could not verify ${tx.transactionReference} after claiming it`)
        continue
      }

      try {
        await applyProviderPayment({
          supabase,
          schoolId,
          studentId: student.id,
          amountPaid: verified.amountPaid,
          settlementAmount: verified.settlementAmount,
          provider: provider.name,
          providerReference: verified.paymentReference,
          providerTransactionId: verified.transactionReference,
          paidAt: verified.paidOn.includes('T') ? verified.paidOn : new Date(verified.paidOn.replace(' ', 'T')).toISOString(),
        })
        result.applied++
      } catch (err: any) {
        result.errors.push(`apply failed for ${tx.transactionReference}: ${err?.message || 'unknown error'}`)
      }
    }
  }

  const { data: families } = await supabase
    .from('families')
    .select('id, provider_dva_reference')
    .eq('school_id', schoolId)
    .not('provider_dva_reference', 'is', null)

  for (const family of families || []) {
    result.familiesChecked++

    const transactions = await provider.listDVATransactions(family.provider_dva_reference)

    for (const tx of transactions) {
      result.transactionsChecked++
      if (tx.paymentStatus !== 'PAID') continue

      const { error: claimError } = await supabase
        .from('processed_provider_transactions')
        .insert({ school_id: schoolId, provider: provider.name, provider_transaction_id: tx.transactionReference })

      if (claimError) {
        if (claimError.code === '23505') continue
        result.errors.push(`claim failed for ${tx.transactionReference}: ${claimError.message}`)
        continue
      }

      const verified = await provider.verifyTransaction(tx.transactionReference)
      if (!verified) {
        result.errors.push(`could not verify ${tx.transactionReference} after claiming it`)
        continue
      }

      try {
        await applyProviderPayment({
          supabase,
          schoolId,
          familyId: family.id,
          amountPaid: verified.amountPaid,
          settlementAmount: verified.settlementAmount,
          provider: provider.name,
          providerReference: verified.paymentReference,
          providerTransactionId: verified.transactionReference,
          paidAt: verified.paidOn.includes('T') ? verified.paidOn : new Date(verified.paidOn.replace(' ', 'T')).toISOString(),
        })
        result.applied++
      } catch (err: any) {
        result.errors.push(`apply failed for ${tx.transactionReference}: ${err?.message || 'unknown error'}`)
      }
    }
  }

  // Stamp the sweep time so the Payments ledger can show "last run" for both
  // this manual path and the cron. Only reached when a provider existed and a
  // real sweep ran; a no-provider early return above leaves the marker alone.
  await supabase
    .from('schools')
    .update({ last_reconciled_at: new Date().toISOString() })
    .eq('id', schoolId)

  return result
}
