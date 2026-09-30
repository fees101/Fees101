// Fires when a message exhausts every channel in the fallback chain (either
// synchronously in sendMessageWithFallback/sendMultiChannel, or later from a
// provider's webhook / the daily sweep once a channel's delivery report
// comes back failed). Writes an in-app banner (admin_notifications row) —
// the notification of record.

interface MessageFailureDetails {
  studentName?: string
  messageType: string
  channelsAttempted: string[]
}

export async function notifyAdminOfMessageFailure(
  supabase: any,
  schoolId: string,
  details: MessageFailureDetails,
  relatedMessageId?: string | null
): Promise<void> {
  const subjectLine = details.studentName
    ? `Message delivery failed for ${details.studentName}`
    : 'Message delivery failed'
  const bodyText =
    `A ${details.messageType} message could not be delivered on any channel ` +
    `(tried: ${details.channelsAttempted.join(', ') || 'none available'}). ` +
    `Check message_logs for details.`

  await supabase.from('admin_notifications').insert({
    school_id: schoolId,
    type: 'message_delivery_failed',
    title: subjectLine,
    body: bodyText,
    related_message_id: relatedMessageId || null,
  })
}
