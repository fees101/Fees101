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
// BUG FOUND (2026-08-18): sending `to` as an array (per the docs' literal
// type) silently puts the request in batch/bulk mode — accepted and billed,
// but the response is account-level ({business_id, total_contacts,
// valid_count, ...}) with no per-message id/reference at all, and this may
// be why the DLR webhook never fired for any real send so far. Confirmed via
// direct curl against the live API with the real key that sending `to` as a
// bare string (not an array) returns the proper single-message shape
// ({id, reference, phone_number, status: 'processing'}), matching Sendchamp's
// own dashboard "Test SMS" tool and its Transaction Ref format (MN-SMS-...).
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
      to: params.to,
      message: params.text,
      sender_name: senderName,
      route,
      type: 'text',
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
