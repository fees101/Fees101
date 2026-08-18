// Sendchamp implementation of MessagingProvider — replacing Termii as the SMS
// provider now that a Sendchamp Sender ID is approved. Termii's adapter
// (termii.ts) is left in place, untouched, as a fallback we can flip back to
// with a one-line env change if Sendchamp turns out to have issues in
// practice — see SMS_PROVIDER in sendMessage.ts.
//
// Docs (fetched 2026-08-10, https://sendchamp.readme.io):
//   POST https://api.sendchamp.com/api/v1/sms/send
//   Authorization: Bearer <api key>
//   Body: { to: string[], message, sender_name, route: 'dnd'|'non_dnd'|'international' }
//   Docs show: { status: 'success', data: { id, reference, phone_number, status: 'processing' } }
// "route: dnd" is the transactional route that bypasses Nigerian DND-active
// numbers — the equivalent of Termii's channel: 'dnd' we used before.
//
// REALITY (confirmed against a real live send, 2026-08-18): the actual
// response has no `data.reference`/`data.id` at all — it's account/batch
// level: { code:200, status:'success', message:'sent',
// data:{ business_id, total_contacts, valid_count, created_at, updated_at } }.
// So there is currently no per-message ID to key a delivery-report webhook
// off of — providerMessageId is null on a real send until Sendchamp support
// clarifies where a message-level ID comes from. The webhook route's match
// against provider_message_id will not fire for now; delivery status stays
// at 'sent' (accepted) rather than upgrading to delivered/failed.
//
// Webhook delivery reports (webhook.ts / route.ts) — Sendchamp's docs show a
// payload shape but do NOT document any signature/secret scheme for verifying
// the callback (unlike Termii's HMAC header). Until Sendchamp support
// confirms one exists, the webhook route trusts a shared secret appended to
// the registered callback URL instead (?secret=...) rather than skipping
// verification outright.

import { MessagingProvider, SendParams, SendResult } from './types'

function config() {
  return {
    mode: process.env.SENDCHAMP_MODE || 'mock',
    baseUrl: (process.env.SENDCHAMP_BASE_URL || 'https://api.sendchamp.com/api/v1').replace(/\/$/, ''),
    apiKey: process.env.SENDCHAMP_API_KEY || '',
    senderName: process.env.SENDCHAMP_SENDER_ID || 'Sendchamp',
    route: process.env.SENDCHAMP_ROUTE || 'dnd',
  }
}

export class SendchampProvider implements MessagingProvider {
  async send(params: SendParams): Promise<SendResult> {
    const { mode } = config()

    // MOCK: exercise the whole flow with no real message and no wallet spend.
    if (mode !== 'live') {
      return {
        ok: true,
        mock: true,
        providerMessageId: `mock-${Date.now()}`,
        raw: { status: 'success', message: 'processing (mock)', channel: params.channel },
      }
    }

    return this.sendSms(params)
  }

  private async sendSms(params: SendParams): Promise<SendResult> {
    const { baseUrl, apiKey, senderName, route } = config()
    const body = {
      to: [params.to],
      message: params.text,
      sender_name: senderName,
      route,
    }

    try {
      const res = await fetch(`${baseUrl}/sms/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })
      const json: any = await res.json().catch(() => ({}))

      // Success in practice is just { status: 'success' } — see the header
      // comment on why we no longer require data.reference/data.id.
      if (res.ok && json?.status === 'success') {
        return { ok: true, providerMessageId: json?.data?.reference || json?.data?.id || null, raw: json }
      }
      return { ok: false, error: json?.errors || json?.message || json?.error || `HTTP ${res.status}`, raw: json }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error reaching Sendchamp' }
    }
  }
}

export const sendchamp = new SendchampProvider()
