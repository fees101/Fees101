'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { MessageChannel } from '@/lib/messaging/types'
import { sendInvoiceCore } from '@/lib/invoicing/sendInvoice'
import { logAuditEvent } from '@/lib/audit/logAudit'

async function getContext() {
  // Gated on the 'manage-invoices' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-invoices')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

export async function sendInvoice(
  invoiceId: string,
  channelOverride?: MessageChannel
): Promise<{ error: string } | { success: true; channelsUsed: MessageChannel[]; to: string; preview: string }> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const result = await sendInvoiceCore(supabase, schoolId, invoiceId, channelOverride)
  if ('error' in result) return result

  revalidatePath(`/invoices/${invoiceId}`)

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.sent',
    targetType: 'invoice',
    targetId: invoiceId,
    summary: `Sent the invoice for ${result.studentName} via ${result.channelsUsed.join(', ') || 'no channel'}`,
    metadata: { studentId: result.studentId, channelsUsed: result.channelsUsed, outstanding: result.outstanding, channelOverride },
  })

  return {
    success: true,
    channelsUsed: result.channelsUsed,
    to: result.to,
    preview: result.preview,
  }
}
