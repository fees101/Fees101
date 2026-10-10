// One-time historical backfill for payments.provider_fee (db/payment_provider_fee.sql).
//
// Every NEW Paystack/Monnify payment already gets a real provider_fee at
// webhook time — paystackWebhookProcessor.ts and webhookProcessor.ts both
// compute settlementAmount from the provider's own real per-transaction
// figure (Paystack's `data.fees`, Monnify's `eventData.settlementAmount`),
// and applyPayment.ts's applyProviderPayment() stores
// amountPaid - settlementAmount as provider_fee on exactly one payments row
// per real transaction (see applyPayment.ts's nextProviderFee() — a transfer
// that cascades across several invoices produces several payments rows from
// one real transaction, and the fee is attributed once so summing this
// column never double-counts it).
//
// Rows created BEFORE that capture existed (or from any gap in it) have
// provider set but provider_fee null. This module finds those, groups them
// back into their real-world transactions (by provider + provider_reference,
// the same unit applyProviderPayment() used), and asks the provider's own
// verify API for the real fee — never a guessed/hardcoded percentage, which
// would be wrong for DVA/transfer-collected payments vs. card vs. USSD.
// Reuses the same PaymentProvider.verifyTransaction() every other
// reconciliation path already calls (reconcile.ts, the refund sweep) rather
// than inventing a second way to talk to Paystack/Monnify.
//
// Batched/resumable via the existing background_jobs/advanceJob.ts pattern
// (src/lib/jobs/advanceJob.ts's advanceProviderFeeBackfill) — same chunk
// size, time budget, and provider-outage/rate-limit pause-and-resume
// behaviour as bulk DVA creation (provisionDVA.ts), not a new mechanism.
// Triggered via POST /api/admin/backfill-provider-fees (shared-secret
// protected, same shape as /api/admin/reconcile) — see that route for how to
// run this.

import { PaymentProvider } from './types'
import { isProviderDownError, isRateLimitError } from './providerErrors'

export interface ProviderFeeGapGroup {
  // provider + provider_reference identify one real-world transaction, same
  // key applyProviderPayment() used to attribute the fee to a single row.
  provider: string
  reference: string
  // Every payments row this transaction produced, oldest-created first. The
  // real fee gets written to paymentIds[0] only — matching how the webhook
  // would have attributed it, so summing provider_fee stays double-count-free.
  paymentIds: string[]
  // Sum of this transaction's split amounts, for the failures/log output —
  // not written anywhere, just lets a human sanity-check a flagged gap.
  amountPaid: number
}

// Scoped to one school (same boundary as processBulkDVAChunk) — payments is
// not bounded by tenant count platform-wide, but one school's own payment
// history is, and this needs that school's own decrypted provider
// credentials anyway (getPaymentProviderForSchool), so there is no
// platform-wide variant of this query.
export async function findProviderFeeGaps(supabase: any, schoolId: string): Promise<ProviderFeeGapGroup[]> {
  const { data: rows, error } = await supabase
    .from('payments')
    .select('id, provider, provider_reference, amount, provider_fee, created_at')
    .eq('school_id', schoolId)
    .not('provider', 'is', null)
    .not('provider_reference', 'is', null)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to load payments for provider-fee backfill: ${error.message}`)

  const groups = new Map<string, { provider: string; reference: string; paymentIds: string[]; amountPaid: number; hasFee: boolean }>()
  for (const r of rows || []) {
    const key = `${r.provider}::${r.provider_reference}`
    const g = groups.get(key) || { provider: r.provider as string, reference: r.provider_reference as string, paymentIds: [], amountPaid: 0, hasFee: false }
    g.paymentIds.push(r.id as string)
    g.amountPaid += Number(r.amount) || 0
    if (r.provider_fee !== null && r.provider_fee !== undefined) g.hasFee = true
    groups.set(key, g)
  }

  // Only transactions where NO row carries a fee yet — a group where one
  // split already has it (the normal, correctly-attributed case) needs no
  // backfill at all.
  return Array.from(groups.values())
    .filter((g) => !g.hasFee)
    .map((g) => ({ provider: g.provider, reference: g.reference, paymentIds: g.paymentIds, amountPaid: g.amountPaid }))
}

export interface ProviderFeeBackfillChunkResult {
  succeeded: number
  failed: number
  failures: { label: string; error: string }[]
  // Groups not yet attempted because the provider was rate-limiting/down —
  // same "pause, don't burn" contract as processBulkDVAChunk's `unprocessed`.
  unprocessed: ProviderFeeGapGroup[]
}

// Paces verify calls so a backfill of hundreds of historical rows doesn't
// burst into Paystack/Monnify's read rate limit — same spirit as
// provisionDVA.ts's PROVISION_THROTTLE_MS, slightly higher since this hits a
// per-school job with no interactive user waiting on it.
const VERIFY_THROTTLE_MS = 300

export async function processProviderFeeBackfillChunk(
  supabase: any,
  schoolId: string,
  provider: PaymentProvider,
  groups: ProviderFeeGapGroup[]
): Promise<ProviderFeeBackfillChunkResult> {
  if (groups.length === 0) return { succeeded: 0, failed: 0, failures: [], unprocessed: [] }

  let succeeded = 0
  const failures: { label: string; error: string }[] = []

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]

    // A school that has since switched providers has old rows stamped with
    // the PREVIOUS provider's name — there is no way to verify those against
    // the school's current credentials (the old account may not even exist
    // anymore). Flagged, not silently skipped, so a human can see exactly
    // which transactions can never be backfilled this way.
    if (g.provider !== provider.name) {
      failures.push({
        label: `${g.provider} ${g.reference}`,
        error: `This school is currently configured for "${provider.name}", but this transaction was recorded under "${g.provider}" — cannot verify it against a different provider's API.`,
      })
      continue
    }

    try {
      const verified = await provider.verifyTransaction(g.reference)
      if (!verified) {
        // Expected for pre-launch test/synthetic references that were never
        // real provider transactions (seen live, 2026-10: every current gap
        // in this school's history is one of these) — not a crash, just
        // "nothing to backfill here."
        failures.push({ label: `${g.provider} ${g.reference}`, error: 'Not found at the provider (likely a test/synthetic reference, never a real transaction)' })
        continue
      }

      const fee = Math.max(0, Math.round((verified.amountPaid - verified.settlementAmount) * 100) / 100)
      const targetId = g.paymentIds[0]
      const { error: updateError } = await supabase
        .from('payments')
        .update({ provider_fee: fee })
        .eq('id', targetId)
        .eq('school_id', schoolId)
        // Belt-and-braces: never overwrite a fee that landed (e.g. from a
        // concurrent webhook retry) between findProviderFeeGaps() running and
        // this update executing.
        .is('provider_fee', null)

      if (updateError) throw new Error(updateError.message)
      succeeded++
    } catch (err: any) {
      if (isProviderDownError(err) || isRateLimitError(err)) {
        return { succeeded, failed: failures.length, failures, unprocessed: groups.slice(i) }
      }
      failures.push({ label: `${g.provider} ${g.reference}`, error: err?.message || 'unknown error' })
    }

    if (i < groups.length - 1) await new Promise((r) => setTimeout(r, VERIFY_THROTTLE_MS))
  }

  return { succeeded, failed: failures.length, failures, unprocessed: [] }
}
