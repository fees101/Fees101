import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'
import { finalizeCompletedRefund } from '@/lib/payments/completeRefund'

// Safety net for a refund.processed/refund.failed webhook that never arrives,
// or arrives but doesn't land (an outage, a dropped delivery, anything on
// either side) — the exact failure mode found live 2026-10-09: a refund sat
// in 'processing' indefinitely even though Paystack's own dashboard already
// showed it settled, with no automatic way for it to ever resolve itself.
// Mirrors message-sweep's reasoning (a provider accepting something isn't
// proof it finished) applied to refunds instead of messages: rather than
// someone having to notice and manually re-run the completion, this actively
// asks Paystack what actually happened to anything that's been "processing"
// too long to still be a normal synchronous wait.
const GRACE_PERIOD_MS = 10 * 60 * 1000 // long enough to never race the synchronous approve-time call

async function runRefundSweep() {
  const supabase = createServiceRoleClient()
  const staleBefore = new Date(Date.now() - GRACE_PERIOD_MS).toISOString()

  const { data: stuck } = await supabase
    .from('refunds')
    .select('id, school_id, paystack_refund_id')
    .eq('status', 'processing')
    .in('refund_method', ['paystack_reversal', 'monnify_reversal'])
    .not('paystack_refund_id', 'is', null)
    .lt('approved_at', staleBefore)

  const results: { refundId: string; schoolId: string; outcome: string }[] = []

  for (const row of (stuck || []) as { id: string; school_id: string; paystack_refund_id: string }[]) {
    try {
      const provider = await getPaymentProviderForSchool(row.school_id, supabase)
      if (!provider?.verifyRefund) {
        results.push({ refundId: row.id, schoolId: row.school_id, outcome: 'no_provider' })
        continue
      }

      const { status } = await provider.verifyRefund(row.paystack_refund_id)

      if (status === 'processed') {
        const { error } = await supabase.rpc('complete_refund_request', {
          p_refund_id: row.id,
          p_paystack_refund_id: row.paystack_refund_id,
        })
        if (error) throw error
        await finalizeCompletedRefund(supabase, row.id)
        results.push({ refundId: row.id, schoolId: row.school_id, outcome: 'completed' })
      } else if (status === 'failed') {
        const { error } = await supabase.rpc('fail_refund_request', {
          p_refund_id: row.id,
          p_reason: `${provider.name === 'monnify' ? 'Monnify' : 'Paystack'} reported the refund as failed (caught by the refund sweep, not a webhook)`,
        })
        if (error) throw error
        results.push({ refundId: row.id, schoolId: row.school_id, outcome: 'failed' })
      } else {
        // Still genuinely pending on the provider's side — leave it, the
        // sweep will check again next run.
        results.push({ refundId: row.id, schoolId: row.school_id, outcome: 'still_pending' })
      }
    } catch (err: any) {
      results.push({ refundId: row.id, schoolId: row.school_id, outcome: `error: ${err?.message || 'unknown'}` })
    }
  }

  return { swept: results.length, results }
}

// Manual/CI trigger — same pattern as job-sweep.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-sweep-secret')
  if (!secret || secret !== process.env.SWEEP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runRefundSweep())
}

// Vercel Cron invokes with GET — see vercel.json for the schedule.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runRefundSweep())
}
