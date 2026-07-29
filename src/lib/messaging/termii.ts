// Termii (v4) implementation of MessagingProvider. Verified against the real
// account: base https://v4.api.termii.com, POST /api/sms/send, api_key in body,
// channel "dnd" for transactional SMS.
//
// TERMII_SENDER_ID is our approved custom Sender ID ("OE Alert"). The
// original "Fees101" Sender ID application was rejected by Termii.
//
// TERMII_MODE controls whether we actually hit the network:
//   mock  → no HTTP, no charge; returns Termii's success shape. Use for dev/tests.
//   live  → real send.
//
// WhatsApp support was removed (2026-07-28) — it was never verified against a
// real approved device/template, and WhatsApp will be rebuilt against
// SendChamp instead once that account exists, rather than finishing it here.
// Termii stays as the SMS provider only for now.
//
// Email does NOT go through Termii (their email API is paid and
// template-driven) — email sending goes through Amazon SES instead, see
// ses.ts.

import { MessagingProvider, SendParams, SendResult } from './types'

function config() {
  return {
    mode: process.env.TERMII_MODE || 'mock',
    baseUrl: (process.env.TERMII_BASE_URL || 'https://v4.api.termii.com').replace(/\/$/, ''),
    apiKey: process.env.TERMII_API_KEY || '',
    senderId: process.env.TERMII_SENDER_ID || '',
  }
}

export class TermiiProvider implements MessagingProvider {
  async send(params: SendParams): Promise<SendResult> {
    const { mode } = config()

    // MOCK: exercise the whole flow with no real message and no wallet spend.
    if (mode !== 'live') {
      return {
        ok: true,
        mock: true,
        providerMessageId: `mock-${Date.now()}`,
        raw: { message: 'Successfully Sent (mock)', channel: params.channel },
      }
    }

    return this.sendSms(params)
  }

  private async sendSms(params: SendParams): Promise<SendResult> {
    const { baseUrl, apiKey, senderId } = config()
    const body: Record<string, unknown> = {
      api_key: apiKey,
      to: params.to,
      from: senderId,
      sms: params.text,
      type: 'plain',
      channel: 'dnd',
    }

    try {
      const res = await fetch(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json: any = await res.json().catch(() => ({}))

      // Termii v4 success looks like { message_id, message: "Successfully Sent", balance, ... }
      if (res.ok && /success/i.test(json?.message || '')) {
        return { ok: true, providerMessageId: json.message_id, raw: json }
      }
      return { ok: false, error: json?.message || `HTTP ${res.status}`, raw: json }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error reaching Termii' }
    }
  }
}

export const termii = new TermiiProvider()

export function getMessagingMode(): 'mock' | 'live' {
  return process.env.TERMII_MODE === 'live' ? 'live' : 'mock'
}
