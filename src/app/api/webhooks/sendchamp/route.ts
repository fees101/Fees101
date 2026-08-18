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

// Matches sendMessage.ts's normalizePhone — kept duplicated here since this
// route is deliberately self-contained (see the file header).
function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/[^\d]/g, '')
  if (digits.startsWith('234')) return digits
  if (digits.startsWith('0')) return '234' + digits.slice(1)
  return digits
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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Recorded regardless of whether we can match a message_logs row — this is
  // how we confirm Sendchamp is actually calling this URL at all.
  const { data: eventRow } = await supabase
    .from('webhook_events')
    .insert({ source: 'sendchamp', payload })
    .select('id')
    .single()

  // providerMessageId is stored as the send response's `data.reference` — in
  // practice a real live send never returns one (confirmed 2026-08-18), so
  // this branch currently never matches; kept in case Sendchamp starts
  // returning one. Falls back to the most recent unresolved 'sent' row to
  // the same phone number instead.
  const messageId: string | undefined = payload?.reference || payload?.sms_uid
  const status = mapStatus(payload?.status)
  const phone = payload?.phone_number ? normalizePhone(payload.phone_number) : undefined

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
      .select('id'))
  }

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
      .select('id'))
  }

  if (error) console.error('[sendchamp webhook] failed to update message_logs', error)
  if (eventRow?.id) {
    await supabase.from('webhook_events').update({ matched: !!data?.length }).eq('id', eventRow.id)
  }

  return NextResponse.json({ received: true })
}
