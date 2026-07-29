// Provider-agnostic messaging contracts. The rest of the app sends through
// these interfaces and never talks to Termii/SES directly — so switching
// provider, or tweaking a provider's quirks, is confined to one adapter file.
//
// Two channels: 'sms' via Termii (see termii.ts), 'email' via Amazon SES (see
// ses.ts) — used both as a fallback when SMS delivery fails, and as the
// direct sender for PDF-attached invoice/receipt emails (an SMS can't carry
// an attachment). WhatsApp was removed (2026-07-28) — it will be rebuilt
// against SendChamp once that account exists.

export type MessageChannel = 'sms' | 'email'

export interface SendParams {
  // Recipient: phone in international format without '+'.
  to: string
  // The plain-text body.
  text: string
  channel: MessageChannel
}

export interface SendResult {
  ok: boolean
  // Provider's message id (for delivery-status correlation later).
  providerMessageId?: string
  // True when this was a simulated send (TERMII_MODE/SES_MODE=mock) — no real
  // message, no charge.
  mock?: boolean
  error?: string
  // Raw provider response, for debugging.
  raw?: unknown
}

export interface MessagingProvider {
  send(params: SendParams): Promise<SendResult>
}

export interface EmailAttachment {
  filename: string
  content: Buffer
  contentType: string
}

export interface EmailSendParams {
  to: string
  subject: string
  html: string
  text: string
  attachments?: EmailAttachment[]
}

export interface EmailProvider {
  send(params: EmailSendParams): Promise<SendResult>
}
