// The send engine: provider-agnostic business logic. SMS goes through the
// Termii adapter, email through the Amazon SES adapter (ses.ts). Every
// attempt is recorded in message_logs (append-only audit + delivery
// tracking).
//
// Two distinct multi-channel behaviors, because they answer different
// questions:
//   sendMessageWithFallback — "get *a* message through." Stops at the first
//     channel that succeeds (only advances on a *synchronous* failure — an
//     accepted-but-later-failed delivery is handled asynchronously by the
//     Termii webhook or the daily sweep via escalateFailedMessage, not here).
//   sendMultiChannel — "every channel carries something the others can't."
//     Fires every channel with a recipient + content, independent of whether
//     the others succeeded — used for invoice-sent/payment-receipt, where
//     SMS is the quick alert and email carries the actual PDF, so one
//     succeeding is never a substitute for the other.
//
// WhatsApp was removed (2026-07-28) — will be rebuilt against SendChamp once
// that account exists.

import { termii } from './termii'
import { ses } from './ses'
import { MessageChannel, SendResult, EmailAttachment } from './types'
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

async function insertLog(
  ctx: SendContext,
  params: {
    channel: MessageChannel
    recipientPhone?: string
    recipientEmail?: string
    content: string
    result: SendResult
    fallbackOfMessageId?: string
  }
): Promise<string | null> {
  const { data } = await ctx.supabase
    .from('message_logs')
    .insert({
      school_id: ctx.schoolId,
      direction: 'outbound',
      recipient_phone: params.recipientPhone || null,
      recipient_email: params.recipientEmail || null,
      channel: params.channel,
      message_type: ctx.messageType,
      content: params.content,
      provider: params.channel === 'email' ? 'ses' : 'termii',
      provider_message_id: params.result.providerMessageId || null,
      status: params.result.ok ? 'sent' : 'failed',
      failed_reason: params.result.ok ? null : (params.result.error || null),
      related_student_id: ctx.studentId || null,
      related_invoice_id: ctx.invoiceId || null,
      fallback_of_message_id: params.fallbackOfMessageId || null,
    })
    .select('id')
    .single()

  return data?.id || null
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
  const messageLogId = await insertLog(ctx, {
    channel, recipientPhone: recipient, content: text, result,
    fallbackOfMessageId: opts?.fallbackOfMessageId,
  })
  return { ...result, messageLogId }
}

export interface EmailContent {
  subject: string
  html: string
  text: string
  attachments?: EmailAttachment[]
}

export async function sendEmail(
  ctx: SendContext,
  to: string,
  content: EmailContent,
  opts?: SendOpts
): Promise<LoggedSendResult> {
  const result = await ses.send({
    to, subject: content.subject, html: content.html, text: content.text,
    attachments: content.attachments,
  })
  const messageLogId = await insertLog(ctx, {
    channel: 'email', recipientEmail: to, content: content.text, result,
    fallbackOfMessageId: opts?.fallbackOfMessageId,
  })
  return { ...result, messageLogId }
}

export interface ChannelContent {
  sms?: string
  email?: EmailContent
}

export interface FallbackRecipients {
  phone?: string
  email?: string
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

const DEFAULT_CHANNEL_ORDER: MessageChannel[] = ['sms', 'email']

export interface FallbackSendOpts {
  channelOrder?: MessageChannel[]
}

function hasChannelInput(recipients: FallbackRecipients, content: ChannelContent, channel: MessageChannel): boolean {
  return channel === 'sms' ? !!(recipients.phone && content.sms) : !!(recipients.email && content.email)
}

async function sendOnChannel(
  ctx: SendContext,
  recipients: FallbackRecipients,
  content: ChannelContent,
  channel: MessageChannel,
  opts?: SendOpts
): Promise<LoggedSendResult> {
  return channel === 'sms'
    ? sendMessage(ctx, recipients.phone!, content.sms!, 'sms', opts)
    : sendEmail(ctx, recipients.email!, content.email!, opts)
}

export async function sendMessageWithFallback(
  ctx: SendContext,
  recipients: FallbackRecipients,
  content: ChannelContent,
  opts: FallbackSendOpts = {}
): Promise<FallbackSendResult> {
  const channelOrder = opts.channelOrder || DEFAULT_CHANNEL_ORDER
  const available = channelOrder.filter((ch) => hasChannelInput(recipients, content, ch))

  const attempts: FallbackAttempt[] = []
  let fallbackOfMessageId: string | undefined

  for (const channel of available) {
    const result = await sendOnChannel(ctx, recipients, content, channel, { fallbackOfMessageId })
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

export interface MultiChannelSendResult {
  attempts: FallbackAttempt[]
  // True if at least one channel succeeded.
  ok: boolean
}

// Fires every channel that has both a recipient and content, independent of
// the others' outcome — see the file header for why this differs from
// sendMessageWithFallback. Used for invoice-sent and payment-receipt.
export async function sendMultiChannel(
  ctx: SendContext,
  recipients: FallbackRecipients,
  content: ChannelContent
): Promise<MultiChannelSendResult> {
  const channels: MessageChannel[] = (['sms', 'email'] as MessageChannel[])
    .filter((ch) => hasChannelInput(recipients, content, ch))

  const attempts: FallbackAttempt[] = []
  for (const channel of channels) {
    const result = await sendOnChannel(ctx, recipients, content, channel)
    attempts.push({ channel, messageLogId: result.messageLogId, ok: result.ok })
  }

  const ok = attempts.some((a) => a.ok)
  if (!ok && attempts.length > 0) {
    await notifyAdminOfMessageFailure(
      ctx.supabase,
      ctx.schoolId,
      { messageType: ctx.messageType, channelsAttempted: attempts.map((a) => a.channel) },
      attempts[attempts.length - 1].messageLogId
    )
  }

  return { attempts, ok }
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Called once a channel is confirmed failed asynchronously (Termii's webhook
// reporting a terminal status, or the daily sweep finding a stale 'sent' row
// with no delivery report). Looks up the student's family contact info fresh
// (the original per-channel content from the initiating call is long gone by
// this point) and continues down the fallback chain from where it left off.
// This is the plain-text fallback path — it never carries a PDF attachment,
// since none was persisted for the original failed attempt; invoice/receipt
// PDFs are always sent up front by sendMultiChannel instead.
export async function escalateFailedMessage(supabase: any, failed: FailedMessageRow): Promise<void> {
  const remaining = DEFAULT_CHANNEL_ORDER.slice(DEFAULT_CHANNEL_ORDER.indexOf(failed.channel) + 1)

  let phone: string | null = null
  let email: string | null = null
  if (failed.related_student_id) {
    const { data: student } = await supabase
      .from('students')
      .select('family_id, families(primary_parent_phone, primary_parent_email)')
      .eq('id', failed.related_student_id)
      .maybeSingle()
    phone = student?.families?.primary_parent_phone || null
    email = student?.families?.primary_parent_email || null
  }

  const ctx: SendContext = {
    supabase,
    schoolId: failed.school_id,
    messageType: failed.message_type,
    studentId: failed.related_student_id || undefined,
    invoiceId: failed.related_invoice_id || undefined,
  }

  for (const channel of remaining) {
    if (channel === 'sms' && phone) {
      await sendMessage(ctx, phone, failed.content, 'sms', { fallbackOfMessageId: failed.id })
      return
    }
    if (channel === 'email' && email) {
      await sendEmail(ctx, email, {
        subject: 'A message from your school',
        html: `<p>${escapeHtml(failed.content).replace(/\n/g, '<br/>')}</p>`,
        text: failed.content,
      }, { fallbackOfMessageId: failed.id })
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
