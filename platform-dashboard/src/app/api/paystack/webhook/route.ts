import { NextRequest, NextResponse } from 'next/server'
import { verifyPaystackWebhookSignature } from '@/lib/paystack'
import { reconcilePlatformTransfer } from '@/lib/platformDva'

// The PLATFORM's Paystack webhook — distinct from api/paystack/callback (that's
// the browser redirect after card capture). Paystack POSTs event notifications
// here; we care about charge.success events on the per-school DVAs so we can
// reconcile inbound transfers against a school's platform bill.
//
// Security: we verify the x-paystack-signature (HMAC-SHA512 of the raw body
// with the platform secret key) BEFORE parsing or acting. An invalid signature
// gets a 401 and nothing is recorded. Everything else returns 200 — Paystack
// retries on non-2xx, so acknowledged-but-ignored events must still be 200.

// Force the Node.js runtime: the signature check uses node:crypto and must see
// the exact raw bytes Paystack sent.
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature')

  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    // Record nothing on a bad signature — could be a spoof.
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let event: {
    event?: string
    data?: {
      status?: string
      reference?: string
      amount?: number
      paid_at?: string
      id?: number | string
      customer?: { customer_code?: string }
    }
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    // Signed but unparseable — ack so Paystack stops retrying.
    return NextResponse.json({ received: true, ignored: 'unparseable' })
  }

  // Only successful charges into a DVA move money we need to reconcile.
  if (event.event !== 'charge.success' || event.data?.status !== 'success') {
    return NextResponse.json({ received: true, ignored: event.event ?? 'unknown' })
  }

  const data = event.data
  const customerCode = data.customer?.customer_code
  if (!customerCode || !data.reference || data.amount == null) {
    return NextResponse.json({ received: true, ignored: 'missing_fields' })
  }

  try {
    const result = await reconcilePlatformTransfer({
      customerCode,
      amount: data.amount / 100, // Paystack sends kobo
      reference: data.reference,
      transactionId: data.id ?? null,
      paidAt: data.paid_at ?? null,
    })
    return NextResponse.json({ received: true, result })
  } catch (err) {
    // A processing failure returns 500 so Paystack retries the delivery; the
    // reference-based idempotency guard makes that retry safe.
    const message = err instanceof Error ? err.message : 'reconcile_failed'
    return NextResponse.json({ received: true, error: message }, { status: 500 })
  }
}
