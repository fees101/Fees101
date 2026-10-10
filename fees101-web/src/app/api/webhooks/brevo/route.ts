// Brevo delivery/bounce report receiver — mirrors webhooks/sendchamp/route.ts.
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
//   Events to tick: Delivered, Hard bounce, Blocked, Invalid email, Spam
//   (added 2026-10-10 — see the spam-complaint handling below; re-tick this
//   in the live Brevo dashboard, ticking it in code alone does nothing).
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
  const event: string = (payload?.event || '').toLowerCase()
  const status = mapStatus(payload?.event)
  console.log('[brevo webhook] received', { messageId, event: payload?.event, mappedStatus: status })

  const supabase = createServiceRoleClient()

  // A spam complaint is a different risk than a bounce: the address is valid
  // and reached the inbox, but the recipient (or their mail provider) flagged
  // it — unlike a bounce, this is NOT evidence the family is unreachable, so
  // it deliberately does not touch message_logs.status or the reachability
  // logic in needs_you_unreachable_families.sql. It still deserves a human's
  // attention for two separate reasons: (1) it may mean the wrong email was
  // entered for a family and the real owner is now annoyed by a stranger's
  // invoice, and (2) repeated spam complaints risk Brevo/ISPs throttling or
  // blocking the sending domain for EVERY school, not just this one — so this
  // is flagged even though no single complaint is actionable on its own.
  // 'unsubscribed' is grouped in here too: our transactional emails carry no
  // unsubscribe link, so Brevo only reports it when a mail client surfaces
  // its own one-click-unsubscribe UI — in practice that is almost always a
  // spam signal wearing a different event name, not a real list opt-out.
  if (event === 'spam' || event === 'unsubscribed') {
    let schoolId: string | null = null
    let studentId: string | null = null
    let messageLogId: string | null = null
    if (messageId) {
      const { data: match } = await supabase
        .from('message_logs')
        .select('id, school_id, related_student_id')
        .eq('provider_message_id', messageId)
        .maybeSingle()
      schoolId = match?.school_id || null
      studentId = match?.related_student_id || null
      messageLogId = match?.id || null
    }
    if (schoolId) {
      const label = event === 'spam' ? 'marked as spam' : 'unsubscribed from'
      await supabase.from('admin_notifications').insert({
        school_id: schoolId,
        type: 'email_spam_complaint',
        title: event === 'spam' ? 'A parent marked a Fees101 email as spam' : 'A parent unsubscribed from Fees101 email',
        body: `${payload?.email || 'A recipient'} ${label} an email from your school` +
          `. The email itself was delivered — this isn't a bad address, but worth checking the right person has this email on file, ` +
          `and repeated reports like this can affect delivery for every school on Fees101.`,
        related_message_id: messageLogId,
        student_id: studentId,
      })
    } else {
      console.warn('[brevo webhook] spam/unsubscribe event with no matching message_logs row', { messageId, email: payload?.email })
    }
    return NextResponse.json({ received: true })
  }

  if (!messageId || !status) {
    return NextResponse.json({ received: true })
  }

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
