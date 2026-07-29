// Amazon SES email provider. PDF attachments require SES's raw-message API
// (SendRawEmailCommand) — the simpler SendEmail can't carry attachments, so
// every send here goes through a hand-built RFC 822 message. mailcomposer is
// used standalone (no nodemailer transport) purely to build that raw MIME
// buffer — headers, multipart boundaries, base64-encoded attachment — since
// SES only accepts finished bytes and doesn't compose MIME itself.
//
// SES_MODE controls whether we actually hit AWS:
//   mock  → no network call, no cost; returns a simulated success. Use for dev/tests.
//   live  → real send via the configured AWS credentials + region.
//
// Credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) are picked up
// automatically from env vars by the SDK's default credential chain — same
// plain-env-var pattern already used for Termii, no AWS profile/config file.

import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses'
import MailComposer from 'mailcomposer'
import { EmailProvider, EmailSendParams, SendResult } from './types'

function config() {
  return {
    mode: process.env.SES_MODE || 'mock',
    region: process.env.AWS_REGION || 'eu-west-1',
    fromEmail: process.env.SES_FROM_EMAIL || '',
    fromName: process.env.SES_FROM_NAME || 'Fees101',
  }
}

function buildRawMessage(params: EmailSendParams, from: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mail = new MailComposer({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    })
    mail.build((err, message) => {
      if (err) reject(err)
      else resolve(message)
    })
  })
}

export class SESProvider implements EmailProvider {
  async send(params: EmailSendParams): Promise<SendResult> {
    const { mode } = config()

    // MOCK: exercise the whole flow with no real message and no AWS cost.
    if (mode !== 'live') {
      return {
        ok: true,
        mock: true,
        providerMessageId: `mock-ses-${Date.now()}`,
        raw: { message: 'Successfully Sent (mock)', to: params.to, subject: params.subject },
      }
    }

    return this.sendLive(params)
  }

  private async sendLive(params: EmailSendParams): Promise<SendResult> {
    const { region, fromEmail, fromName } = config()
    if (!fromEmail) return { ok: false, error: 'SES_FROM_EMAIL is not configured' }

    try {
      const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail
      const raw = await buildRawMessage(params, from)
      const client = new SESClient({ region })
      const result = await client.send(new SendRawEmailCommand({ RawMessage: { Data: raw } }))
      return { ok: true, providerMessageId: result.MessageId, raw: result }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'SES send failed' }
    }
  }
}

export const ses = new SESProvider()

export function getSesMode(): 'mock' | 'live' {
  return process.env.SES_MODE === 'live' ? 'live' : 'mock'
}
