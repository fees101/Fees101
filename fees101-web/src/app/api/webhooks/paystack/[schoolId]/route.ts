import { NextRequest, NextResponse } from 'next/server'
import { processPaystackWebhook } from '@/lib/payments/paystackWebhookProcessor'

// Each school configures this exact URL (with their own school id) in their
// own Paystack dashboard's webhook settings — that's how we know which
// school's secret to verify against before we've parsed anything.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params

  // Must read as text before any JSON parsing — signature verification needs
  // Paystack's exact original bytes, not a re-serialized version.
  const rawBody = await request.text()
  const signatureHeader = request.headers.get('x-paystack-signature')

  const result = await processPaystackWebhook(schoolId, rawBody, signatureHeader)

  return NextResponse.json(result.body, { status: result.status })
}
