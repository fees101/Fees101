// Provider-agnostic messaging contract. The rest of the app sends through this
// interface and never talks to Termii directly — so switching provider, or
// tweaking Termii's v4 quirks, is confined to one adapter file.

export type MessageChannel = 'sms' | 'whatsapp'

export interface SendParams {
  // Recipient in international format without '+', e.g. 2348012345678.
  to: string
  // The plain-text body (SMS, or the resolved WhatsApp text).
  text: string
  channel: MessageChannel
  // WhatsApp only — the approved template + its variables. Ignored for SMS and
  // in mock mode; wired up when the WhatsApp Business templates are approved.
  templateName?: string
  templateVars?: string[]
}

export interface SendResult {
  ok: boolean
  // Provider's message id (for delivery-status correlation later).
  providerMessageId?: string
  // True when this was a simulated send (TERMII_MODE=mock) — no real message,
  // no charge.
  mock?: boolean
  error?: string
  // Raw provider response, for debugging.
  raw?: unknown
}

export interface MessagingProvider {
  send(params: SendParams): Promise<SendResult>
}
