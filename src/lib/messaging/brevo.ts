// Brevo transactional email, via their REST API (not SMTP) — this is what
// lets a send return Brevo's own messageId, which the webhook receiver
// (src/app/api/webhooks/brevo/route.ts) needs to match delivery/bounce
// events back to the right message_logs row, the same way the Sendchamp SMS
// webhook already does for provider_message_id.
//
// EMAIL_MODE controls whether we actually hit the network:
//   mock  → no network call, no cost; returns a simulated success. Use for dev/tests.
//   live  → real send via BREVO_API_KEY.

import { EmailProvider, EmailSendParams, SendResult } from './types'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

function config() {
  return {
    mode: process.env.EMAIL_MODE || 'mock',
    apiKey: process.env.BREVO_API_KEY || '',
    fromEmail: process.env.BREVO_FROM_EMAIL || '',
    fromName: process.env.BREVO_FROM_NAME || 'Fees101',
  }
}

export class BrevoProvider implements EmailProvider {
  async send(params: EmailSendParams): Promise<SendResult> {
    const { mode } = config()

    // MOCK: exercise the whole flow with no real message and no cost.
    if (mode !== 'live') {
      return {
        ok: true,
        mock: true,
        providerMessageId: `mock-brevo-${Date.now()}`,
        raw: { message: 'Successfully Sent (mock)', to: params.to, subject: params.subject },
      }
    }

    return this.sendLive(params)
  }

  private async sendLive(params: EmailSendParams): Promise<SendResult> {
    const { apiKey, fromEmail, fromName } = config()
    if (!fromEmail) return { ok: false, error: 'BREVO_FROM_EMAIL is not configured' }
    if (!apiKey) return { ok: false, error: 'BREVO_API_KEY is not configured' }

    try {
      const res = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: params.to }],
          subject: params.subject,
          htmlContent: params.html,
          textContent: params.text,
          attachment: params.attachments?.map((a) => ({
            name: a.filename,
            content: a.content.toString('base64'),
          })),
        }),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, error: body?.message || `Brevo API error (${res.status})`, raw: body }
      }
      // Brevo returns messageId wrapped in angle brackets, e.g.
      // "<xxxx@smtp-relay.mailin.fr>" — the webhook echoes the same value
      // back as "message-id", so store it verbatim for exact matching.
      return { ok: true, providerMessageId: body?.messageId, raw: body }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Brevo send failed' }
    }
  }
}

export const brevo = new BrevoProvider()

export function getEmailMode(): 'mock' | 'live' {
  return process.env.EMAIL_MODE === 'live' ? 'live' : 'mock'
}
