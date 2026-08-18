// Sendchamp delivery report (DLR) receiver — mirrors webhooks/termii/route.ts.
// Every outbound send is logged as 'sent' the moment Sendchamp's gateway
// *accepts* it (status: 'processing', see sendchamp.ts) — that only means the
// API call succeeded, not that the SMS actually reached the handset.
// Sendchamp calls this URL asynchronously when the real carrier-level status
// is known, so we upgrade the log row to 'delivered' or 'failed'.
//
// Setup (one-time, done in Sendchamp's dashboard, not in code):
//   Account settings > APIs and Webhooks > webhook URL — set to
//   https://<your-domain>/api/webhooks/sendchamp?secret=<SENDCHAMP_WEBHOOK_SECRET>
// Docs: https://sendchamp.readme.io/reference/webhook
//
// Unlike Termii, Sendchamp's docs don't document any request-signing scheme
// (no HMAC header). Until support confirms one exists, this route verifies
// requests via a shared secret in the query string instead of a signature —
// weaker than HMAC, but better than trusting the payload outright.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { escalateFailedMessage, normalizePhone } from '@/lib/messaging/sendMessage'

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

  // providerMessageId is stored as the send response's `data.reference`
  // (sendchamp.ts) — the webhook payload's `reference` field is assumed to be
  // the same value, per Sendchamp's docs example. In practice a real live
  // send never returns a reference (confirmed 2026-08-18 — Sendchamp's send
  // response is account/batch-level only), so this branch currently never
  // matches; kept in case Sendchamp starts returning one. Falls back to the
  // most recent unresolved 'sent' row to the same phone number instead.
  const messageId: string | undefined = payload?.reference || payload?.sms_uid
  const status = mapStatus(payload?.status)
  const phone = payload?.phone_number ? normalizePhone(payload.phone_number) : undefined

  const supabase = createServiceRoleClient()
  const { data: eventRow } = await supabase
    .from('webhook_events')
    .insert({ source: 'sendchamp', payload })
    .select('id')
    .single()

  if (!status) {
    return NextResponse.json({ received: true })
  }

  const update: Record<string, unknown> = { status }
  if (status === 'delivered') update.delivered_at = new Date().toISOString()
  if (status === 'failed') update.failed_reason = payload.status

  let data: any[] | null = null
  let error: any = null

  if (messageId) {
    ;({ data, error } = await supabase
      .from('message_logs')
      .update(update)
      .eq('provider_message_id', messageId)
      .select('id, school_id, channel, message_type, content, related_student_id, related_invoice_id'))
  }

  // No id match (expected today) — fall back to the newest still-'sent'
  // Sendchamp SMS row to this phone number. Fragile (assumes no two
  // in-flight Sendchamp messages to the same number at once) but the only
  // option until Sendchamp returns a real per-message id.
  if ((!data || !data.length) && phone) {
    ;({ data, error } = await supabase
      .from('message_logs')
      .update(update)
      .eq('provider', 'sendchamp')
      .eq('channel', 'sms')
      .eq('recipient_phone', phone)
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(1)
      .select('id, school_id, channel, message_type, content, related_student_id, related_invoice_id'))
  }

  if (error) console.error('[sendchamp webhook] failed to update message_logs', error)
  if (eventRow?.id) {
    await supabase.from('webhook_events').update({ matched: !!data?.length }).eq('id', eventRow.id)
  }
  if (data?.length && status === 'failed') {
    await escalateFailedMessage(supabase, data[0])
  }

  return NextResponse.json({ received: true })
}
