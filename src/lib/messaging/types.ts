// Provider-agnostic messaging contract. The rest of the app sends through this
// interface and never talks to Termii directly — so switching provider, or
// tweaking Termii's v4 quirks, is confined to one adapter file.
//
// Email (SMTP + PDF attachments) was removed — invoice/receipt/reminder
// delivery is SMS-only via Termii for now. Amazon SES will be wired back in
// later as both a fallback channel and the sender for PDF-attached
// invoice/receipt emails. WhatsApp was also removed (2026-07-28) — it will be
// rebuilt against SendChamp once that account exists.

export type MessageChannel = 'sms'

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
