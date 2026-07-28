// The send engine: provider-agnostic business logic. SMS goes through the
// Termii adapter. Every attempt is recorded in message_logs (append-only
// audit + delivery tracking). sendMessageWithFallback only advances to the
// next channel in the order on a *synchronous* failure (the gateway rejects
// the call outright) — an accepted-but-later-failed delivery is handled
// asynchronously by the Termii webhook or the daily sweep, not here.
//
// WhatsApp was removed (2026-07-28) — will be rebuilt against SendChamp once
// that account exists. Email (SMTP + PDF attachments) was removed — see
// composeInvoice.ts. Will be rebuilt against Amazon SES as both a fallback
// channel and the PDF-attached invoice/receipt sender.

import { termii } from './termii'
import { MessageChannel, SendResult } from './types'
import { notifyAdminOfMessageFailure } from './adminNotify'

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

interface SendOpts {
  fallbackOfMessageId?: string
}

interface LoggedSendResult extends SendResult {
  messageLogId: string | null
}

export async function sendMessage(
  ctx: SendContext,
  to: string,
  text: string,
  channel: MessageChannel = 'sms',
  opts?: SendOpts
): Promise<LoggedSendResult> {
  const recipient = normalizePhone(to)
  const result = await termii.send({ to: recipient, text, channel })

  const { data } = await ctx.supabase
    .from('message_logs')
    .insert({
      school_id: ctx.schoolId,
      direction: 'outbound',
      recipient_phone: recipient,
      channel,
      message_type: ctx.messageType,
      content: text,
      provider: 'termii',
      provider_message_id: result.providerMessageId || null,
      status: result.ok ? 'sent' : 'failed',
      failed_reason: result.ok ? null : (result.error || null),
      related_student_id: ctx.studentId || null,
      related_invoice_id: ctx.invoiceId || null,
      fallback_of_message_id: opts?.fallbackOfMessageId || null,
    })
    .select('id')
    .single()

  return { ...result, messageLogId: data?.id || null }
}

export interface ChannelContent {
  sms?: string
}

export interface FallbackRecipients {
  phone?: string
}

export interface FallbackAttempt {
  channel: MessageChannel
  messageLogId: string | null
  ok: boolean
}

export interface FallbackSendResult {
  attempts: FallbackAttempt[]
  ok: boolean
  channelUsed: MessageChannel | null
}

const DEFAULT_CHANNEL_ORDER: MessageChannel[] = ['sms']

export interface FallbackSendOpts {
  channelOrder?: MessageChannel[]
}

export async function sendMessageWithFallback(
  ctx: SendContext,
  recipients: FallbackRecipients,
  content: ChannelContent,
  opts: FallbackSendOpts = {}
): Promise<FallbackSendResult> {
  const channelOrder = opts.channelOrder || DEFAULT_CHANNEL_ORDER
  const available = channelOrder.filter((ch) => !!recipients.phone && !!content[ch])

  const attempts: FallbackAttempt[] = []
  let fallbackOfMessageId: string | undefined

  for (const channel of available) {
    const text = content[channel] as string
    const result = await sendMessage(ctx, recipients.phone!, text, channel, { fallbackOfMessageId })
    attempts.push({ channel, messageLogId: result.messageLogId, ok: result.ok })

    if (result.ok) {
      return { attempts, ok: true, channelUsed: channel }
    }
    fallbackOfMessageId = result.messageLogId || undefined
  }

  // Nothing available, or every available channel failed synchronously —
  // there's nothing left in flight for the webhook/sweep to pick up later.
  await notifyAdminOfMessageFailure(
    ctx.supabase,
    ctx.schoolId,
    { messageType: ctx.messageType, channelsAttempted: attempts.map((a) => a.channel) },
    attempts.length ? attempts[attempts.length - 1].messageLogId : null
  )

  return { attempts, ok: false, channelUsed: null }
}

interface FailedMessageRow {
  id: string
  school_id: string
  channel: MessageChannel
  message_type: MessageType
  content: string
  related_student_id: string | null
  related_invoice_id: string | null
}

// Called once a channel is confirmed failed asynchronously (Termii's webhook
// reporting a terminal status, or the daily sweep finding a stale 'sent' row
// with no delivery report). Looks up the student's family contact info fresh
// (the original per-channel content from the initiating call is long gone by
// this point) and continues down the fallback chain from where it left off.
export async function escalateFailedMessage(supabase: any, failed: FailedMessageRow): Promise<void> {
  const remaining = DEFAULT_CHANNEL_ORDER.slice(DEFAULT_CHANNEL_ORDER.indexOf(failed.channel) + 1)

  let phone: string | null = null
  if (failed.related_student_id) {
    const { data: student } = await supabase
      .from('students')
      .select('family_id, families(primary_parent_phone)')
      .eq('id', failed.related_student_id)
      .maybeSingle()
    phone = student?.families?.primary_parent_phone || null
  }

  const ctx: SendContext = {
    supabase,
    schoolId: failed.school_id,
    messageType: failed.message_type,
    studentId: failed.related_student_id || undefined,
    invoiceId: failed.related_invoice_id || undefined,
  }

  for (const channel of remaining) {
    if (phone) {
      await sendMessage(ctx, phone, failed.content, channel, { fallbackOfMessageId: failed.id })
      return
    }
  }

  // No remaining channel has a usable recipient — chain is exhausted.
  await notifyAdminOfMessageFailure(
    supabase,
    failed.school_id,
    { messageType: failed.message_type, channelsAttempted: [failed.channel] },
    failed.id
  )
}
