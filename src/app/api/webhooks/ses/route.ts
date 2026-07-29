// Amazon SES delivery/bounce/complaint receiver, via an SNS topic subscribed
// to the verified SES identity's event notifications. Mirrors the Termii DLR
// webhook pattern (src/app/api/webhooks/termii/route.ts): every outbound
// email is logged as 'sent' the moment SES's API *accepts* it (see
// sendMessage.ts) — that only means SES queued it, not that it reached the
// inbox. SNS calls this URL asynchronously once the real outcome is known.
//
// Setup (one-time, done in the AWS console, not in code):
//   SES console > Verified identity > Notifications > Feedback Notifications
//   > SNS topic for Bounce/Complaint/Delivery > subscribe this URL as an
//   HTTPS endpoint: https://<your-domain>/api/webhooks/ses
//   Confirming the subscription (SNS "SubscriptionConfirmation" message) is
//   handled automatically below.
//
// SECURITY NOTE (tracked for go-live, not done yet): this does not verify
// the SNS message signature, so anything that can reach this URL can forge
// a delivery status. Acceptable for V1/mock testing; before production, add
// signature verification (fetch the cert from SigningCertURL, verify RSA-
// SHA1 over the canonical string) or switch to SNS message filtering + IAM
// auth on the endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { escalateFailedMessage } from '@/lib/messaging/sendMessage'

function mapNotificationType(type: string): 'delivered' | 'failed' | null {
  if (type === 'Delivery') return 'delivered'
  if (type === 'Bounce' || type === 'Complaint') return 'failed'
  return null
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // SNS requires the subscription to be confirmed by visiting SubscribeURL
  // once, before it will deliver any real notifications to this endpoint.
  if (payload.Type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
    console.log('[ses webhook] confirming SNS subscription', { topicArn: payload.TopicArn })
    try {
      await fetch(payload.SubscribeURL)
    } catch (e: any) {
      console.warn('[ses webhook] failed to confirm subscription', e?.message)
    }
    return NextResponse.json({ received: true })
  }

  if (payload.Type !== 'Notification') {
    return NextResponse.json({ received: true })
  }

  let message: any
  try {
    message = JSON.parse(payload.Message)
  } catch {
    return NextResponse.json({ error: 'Invalid inner message' }, { status: 400 })
  }

  const status = mapNotificationType(message?.notificationType)
  const messageId: string | undefined = message?.mail?.messageId
  console.log('[ses webhook] received', { messageId, notificationType: message?.notificationType, mappedStatus: status })

  if (!messageId || !status) {
    return NextResponse.json({ received: true })
  }

  const supabase = createServiceRoleClient()
  const failedReason = status === 'failed'
    ? (message.notificationType === 'Bounce'
        ? `Bounce: ${message.bounce?.bounceType || ''} ${message.bounce?.bounceSubType || ''}`.trim()
        : 'Complaint')
    : null

  const update: Record<string, unknown> = { status }
  if (status === 'delivered') update.delivered_at = new Date().toISOString()
  if (status === 'failed') update.failed_reason = failedReason

  const { data, error } = await supabase
    .from('message_logs')
    .update(update)
    .eq('provider_message_id', messageId)
    .eq('channel', 'email')
    .select('id, school_id, channel, message_type, content, related_student_id, related_invoice_id')
    .maybeSingle()

  if (error) {
    console.error('[ses webhook] failed to update message_logs', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (data && status === 'failed') {
    await escalateFailedMessage(supabase, data)
  }

  return NextResponse.json({ received: true })
}
