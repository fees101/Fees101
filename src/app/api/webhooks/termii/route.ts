// Termii delivery report (DLR) receiver. Every outbound send is logged as
// 'sent' the moment Termii's gateway *accepts* it (see sendMessage.ts) — that
// only means the API call succeeded, not that the SMS actually reached the
// handset. Termii calls this URL asynchronously when the real carrier-level
// status is known, so we upgrade the log row to 'delivered' or 'failed'.
//
// Setup (one-time, done in Termii's dashboard, not in code):
//   Developer console > Webhook URL > set to https://<your-domain>/api/webhooks/termii
// Docs: https://developers.termii.com/events-and-reports
//
// Requests are signed with header X-Termii-Signature = HMAC-SHA512(rawBody, secret).
// We use TERMII_API_KEY as the secret by default; if Termii's dashboard shows
// a distinct webhook signing secret, set TERMII_WEBHOOK_SECRET instead.

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

function isValidSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.TERMII_WEBHOOK_SECRET || process.env.TERMII_API_KEY || ''
  if (!signature || !secret) return false

  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected)
  const signatureBuf = Buffer.from(signature)
  if (expectedBuf.length !== signatureBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, signatureBuf)
}

// Termii's documented statuses: Delivered, DND Active on Phone Number,
// Message Sent, Received, Message Failed, Rejected, Expired. Only map the
// terminal ones — "Message Sent" is already recorded, nothing to upgrade.
function mapStatus(termiiStatus: string): 'delivered' | 'failed' | null {
  const s = (termiiStatus || '').toUpperCase()
  if (s === 'DELIVERED') return 'delivered'
  if (s === 'MESSAGE FAILED' || s === 'REJECTED' || s === 'EXPIRED' || s.includes('DND ACTIVE')) return 'failed'
  return null
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-termii-signature')

  if (!isValidSignature(rawBody, signature)) {
    // Termii's docs don't confirm which secret signs the payload — log enough
    // to compare against the dashboard by hand without ever logging the
    // secret itself (HMAC digests are one-way, safe to print).
    console.warn('[termii webhook] signature mismatch', {
      receivedSignature: signature,
      computedWithApiKey: process.env.TERMII_API_KEY
        ? crypto.createHmac('sha512', process.env.TERMII_API_KEY).update(rawBody).digest('hex')
        : null,
      bodyPreview: rawBody.slice(0, 300),
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const messageId: string | undefined = payload?.message_id
  const status = mapStatus(payload?.status)
  console.log('[termii webhook] received', { messageId, rawStatus: payload?.status, mappedStatus: status })

  if (!messageId || !status) {
    return NextResponse.json({ received: true })
  }

  const supabase = createServiceRoleClient()
  const update: Record<string, unknown> = { status }
  if (status === 'delivered') update.delivered_at = new Date().toISOString()
  if (status === 'failed') update.failed_reason = payload.status

  const { data, error } = await supabase
    .from('message_logs')
    .update(update)
    .eq('provider_message_id', messageId)
    .select('id')

  if (error) console.error('[termii webhook] failed to update message_logs', error)
  else if (!data?.length) console.warn('[termii webhook] no message_logs row matched provider_message_id', messageId)

  return NextResponse.json({ received: true })
}
