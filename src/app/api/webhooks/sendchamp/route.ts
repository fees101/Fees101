// Sendchamp delivery report (DLR) receiver.
//
// This file is intentionally self-contained and lives here on `main` on its
// own — `main` otherwise only has the original login/signup skeleton, and
// the rest of the messaging feature (sendchamp.ts, sendMessage.ts, etc.)
// lives on `dev` only, not merged here yet. This route talks to Supabase
// directly instead of importing any of that, so `main` doesn't need to grow
// to support it.
//
// Every outbound SMS is logged as 'sent' the moment Sendchamp's gateway
// *accepts* it — that only means the API call succeeded, not that it reached
// the handset. Sendchamp calls this URL asynchronously when the real
// carrier-level status is known, so this upgrades the log row to
// 'delivered' or 'failed'.
//
// Setup (one-time, in Sendchamp's dashboard):
//   Webhook URL = https://app.fees101.com/api/webhooks/sendchamp?secret=<SENDCHAMP_WEBHOOK_SECRET>
// Docs: https://sendchamp.readme.io/reference/webhook
//
// Sendchamp's docs don't document any request-signing scheme (no HMAC
// header, unlike Termii). Until support confirms one exists, this route
// verifies requests via a shared secret in the query string instead.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.SENDCHAMP_WEBHOOK_SECRET || ''
  if (!expected) return false
  return request.nextUrl.searchParams.get('secret') === expected
}

// Sendchamp's documented statuses (SMS Statuses page): only map the terminal
// ones — 'processing' is already recorded, nothing to upgrade.
function mapStatus(sendchampStatus: string): 'delivered' | 'failed' | null {
  const s = (sendchampStatus || '').toLowerCase()
  if (s === 'delivered') return 'delivered'
  if (s === 'failed' || s === 'rejected' || s === 'expired' || s === 'undelivered') return 'failed'
  return null
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: any
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // providerMessageId is stored as the send response's `data.reference` —
  // the webhook payload's `reference` field is assumed to be the same value,
  // per Sendchamp's docs example.
  const messageId: string | undefined = payload?.reference || payload?.sms_uid
  const status = mapStatus(payload?.status)
  console.log('[sendchamp webhook] received', { messageId, rawStatus: payload?.status, mappedStatus: status })

  if (!messageId || !status) {
    return NextResponse.json({ received: true })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const update: Record<string, unknown> = { status }
  if (status === 'delivered') update.delivered_at = new Date().toISOString()
  if (status === 'failed') update.failed_reason = payload.status

  const { data, error } = await supabase
    .from('message_logs')
    .update(update)
    .eq('provider_message_id', messageId)
    .select('id')

  if (error) console.error('[sendchamp webhook] failed to update message_logs', error)
  else if (!data?.length) console.warn('[sendchamp webhook] no message_logs row matched provider_message_id', messageId)

  return NextResponse.json({ received: true })
}
