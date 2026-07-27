// The send engine: provider-agnostic business logic. Sends through the Termii
// adapter and records every attempt in message_logs (append-only audit +
// delivery tracking). Channel selection / WhatsApp-first-with-SMS-fallback will
// build on top of this in the next slice.

import { termii } from './termii'
import { MessageChannel, SendResult } from './types'

// Allowed message_logs.message_type values (DB CHECK constraint).
export type MessageType =
  | 'invoice' | 'invoice_short' | 'invoice_full'
  | 'receipt'
  | 'reminder_advance' | 'reminder_due' | 'reminder_overdue'
  | 'manual'

interface SendContext {
  // RLS-scoped or service-role Supabase client, provided by the caller.
  supabase: any
  schoolId: string
  messageType: MessageType
  studentId?: string
  invoiceId?: string
}

// Normalise a Nigerian number to Termii's expected international, no-'+' form.
export function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/[^\d]/g, '')
  if (digits.startsWith('234')) return digits
  if (digits.startsWith('0')) return '234' + digits.slice(1)
  return digits
}

export async function sendMessage(
  ctx: SendContext,
  to: string,
  text: string,
  channel: MessageChannel = 'sms'
): Promise<SendResult> {
  const recipient = normalizePhone(to)
  const result = await termii.send({ to: recipient, text, channel })

  await ctx.supabase.from('message_logs').insert({
    school_id: ctx.schoolId,
    direction: 'outbound',
    recipient_phone: recipient,
    message_type: ctx.messageType,
    content: text,
    provider: 'termii',
    provider_message_id: result.providerMessageId || null,
    status: result.ok ? 'sent' : 'failed',
    failed_reason: result.ok ? null : (result.error || null),
    related_student_id: ctx.studentId || null,
    related_invoice_id: ctx.invoiceId || null,
  })

  return result
}
