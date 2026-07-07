import { NextRequest, NextResponse } from 'next/server'
import { processMonnifyWebhook } from '@/lib/payments/webhookProcessor'

// Each school configures this exact URL (with their own school id) in their
// own Monnify dashboard's webhook settings — that's how we know which
// school's secret to verify against before we've parsed anything.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params

  // Must read as text before any JSON parsing — signature verification
  // needs Monnify's exact original bytes, not a re-serialized version.
  const rawBody = await request.text()
  const signatureHeader = request.headers.get('monnify-signature')

  const result = await processMonnifyWebhook(schoolId, rawBody, signatureHeader)

  return NextResponse.json(result.body, { status: result.status })
}
