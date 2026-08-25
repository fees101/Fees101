// Brevo delivery/bounce report receiver — mirrors webhooks/termii/route.ts.
// Every outbound email is logged as 'sent' the moment Brevo's API *accepts*
// it (see brevo.ts) — that only means it was queued, not that it reached the
// inbox. Brevo calls this URL asynchronously once the real outcome is known.
//
// Setup (one-time, done in Brevo's dashboard, not in code):
//   Transactional > Settings > Webhooks > add a webhook.
//   URL: https://<your-domain>/api/webhooks/brevo
//   Authentication: "Token" / "Bearer token" (not Basic Auth — no real
//   username applies here, a single shared secret is simpler to manage and
//   rotate). Paste BREVO_WEBHOOK_SECRET as the token value.
//   Events to tick: Delivered, Hard bounce, Blocked, Invalid email.
// Docs: https://developers.brevo.com/docs/transactional-webhooks
//
// Brevo doesn't sign payloads with an HMAC (no signature header, unlike
// Termii) — this checks the Authorization header Brevo sends for
// token/bearer auth, falling back to Basic auth (password only — the
// username field can be anything) and a ?secret= query param, so whichever
// auth style the dashboard actually sends still verifies.

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { escalateFailedMessage } from '@/lib/messaging/sendMessage'

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.BREVO_WEBHOOK_SECRET || ''
  if (!expected) return false

  const auth = request.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    return timingSafeStringEqual(auth.slice(7).trim(), expected)
  }
  if (auth.toLowerCase().startsWith('basic ')) {
    const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8')
    const password = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded
    return timingSafeStringEqual(password, expected)
  }

  const querySecret = request.nextUrl.searchParams.get('secret')
  return !!querySecret && timingSafeStringEqual(querySecret, expected)
}

// Brevo's documented transactional events: request, delivered, hard_bounce,
// soft_bounce, blocked, invalid_email, deferred, click, opened,
// unique_opened, spam, unsubscribed, error. Only the terminal-failure ones
// downgrade the log — soft_bounce/deferred can still resolve on Brevo's own
// retry, and click/opened/spam/unsubscribed aren't delivery-status changes.
function mapStatus(event: string): 'delivered' | 'failed' | null {
  const e = (event || '').toLowerCase()
  if (e === 'delivered') return 'delivered'
  if (e === 'hard_bounce' || e === 'blocked' || e === 'invalid_email' || e === 'error') return 'failed'
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

  // Brevo echoes back the same messageId it returned at send time (brevo.ts),
  // under the field name "message-id".
  const messageId: string | undefined = payload?.['message-id']
  const status = mapStatus(payload?.event)
  console.log('[brevo webhook] received', { messageId, event: payload?.event, mappedStatus: status })

  if (!messageId || !status) {
    return NextResponse.json({ received: true })
  }

  const supabase = createServiceRoleClient()
  const update: Record<string, unknown> = { status }
  if (status === 'delivered') update.delivered_at = new Date().toISOString()
  if (status === 'failed') update.failed_reason = payload?.reason || payload?.event

  const { data, error } = await supabase
    .from('message_logs')
    .update(update)
    .eq('provider_message_id', messageId)
    .select('id, school_id, channel, message_type, content, related_student_id, related_invoice_id')

  if (error) console.error('[brevo webhook] failed to update message_logs', error)
  else if (!data?.length) console.warn('[brevo webhook] no message_logs row matched provider_message_id', messageId)
  else if (status === 'failed') {
    await escalateFailedMessage(supabase, data[0])
  }

  return NextResponse.json({ received: true })
}
