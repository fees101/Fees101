// Backup to webhooks: polls Monnify directly for each student's DVA
// transaction history and applies anything that never arrived as a webhook
// (delivery failure, misconfigured URL, an outage on either side). Reuses
// the exact same claim-then-cascade path the webhook uses — reconciliation's
// only real job is discovering what was missed, not reprocessing
// differently. Safe to run repeatedly: already-applied transactions are
// skipped via the same processed_provider_transactions claim.

import { getPaymentProviderForSchool } from './getProvider'
import { applyMonnifyPayment } from './applyPayment'
import { logAuditEvent } from '@/lib/audit/logAudit'

export interface ReconcileResult {
  schoolId: string
  studentsChecked: number
  transactionsChecked: number
  applied: number
  errors: string[]
}

export async function reconcileSchool(schoolId: string, supabase: any): Promise<ReconcileResult> {
  const result: ReconcileResult = { schoolId, studentsChecked: 0, transactionsChecked: 0, applied: 0, errors: [] }

  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) {
    result.errors.push('No payment provider configured for this school')
    return result
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
        .insert({ school_id: schoolId, provider: 'monnify', provider_transaction_id: tx.transactionReference })

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
        await applyMonnifyPayment({
          supabase,
          schoolId,
          studentId: student.id,
          amountPaid: verified.amountPaid,
          settlementAmount: verified.settlementAmount,
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

  await logAuditEvent(supabase, {
    schoolId,
    actorId: null,
    action: 'payment.reconciliation_run',
    targetType: 'school',
    targetId: schoolId,
    summary: `Ran payment reconciliation: ${result.applied} matched, ${result.errors.length} unmatched`,
    metadata: {
      studentsChecked: result.studentsChecked,
      transactionsChecked: result.transactionsChecked,
      matched: result.applied,
      unmatched: result.errors.length,
      errors: result.errors,
    },
  })

  return result
}
