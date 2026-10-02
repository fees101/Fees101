import { NextRequest, NextResponse } from 'next/server'
import { processPlatformPaystackWebhook } from '@/lib/platformBilling/webhook'

// Platform-billing webhook endpoint. Set this one fixed URL in the PLATFORM
// Paystack account's webhook settings:
//   https://<app-domain>/api/webhooks/platform-paystack
// It confirms setup-fee and recurring direct-debit charges, and records when a
// mandate becomes active. See lib/platformBilling/webhook.ts for the handling.
//
// Single account -> no [schoolId] in the path (unlike the school-side webhook);
// the school is resolved from the Paystack reference instead.
export async function POST(request: NextRequest) {
  // Raw bytes first: signature verification needs Paystack's exact body.
  const rawBody = await request.text()
  const signature = request.headers.get('x-paystack-signature')

  const result = await processPlatformPaystackWebhook(rawBody, signature)
  return NextResponse.json(result.body, { status: result.status })
}
