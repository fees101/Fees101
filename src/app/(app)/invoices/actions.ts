'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { startBulkSendInvoicesJob, sendInvoiceCore } from '@/lib/invoicing/sendInvoice'
import { logAuditEvent } from '@/lib/audit/logAudit'

async function getContext() {
  // Gated on the 'manage-invoices' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-invoices')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

// Starts a background_jobs 'bulk_send' job for every invoice that's never
// been sent, or was flagged needs_resend after being updated post-send.
// Invoices with nothing outstanding (fully covered by a discount or credit)
// are skipped — there's nothing to remind the parent about. The client polls
// via useTrackedJob (same as invoice generation / bulk DVA) instead of
// driving a client-side loop, so a school with hundreds/thousands of
// invoices can't get stuck re-sending a persistently-failing batch forever.
export async function startBulkSend() {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  return startBulkSendInvoicesJob(supabase, schoolId, userId)
}

// Manual, single-invoice "notify parent this invoice changed" action — the
// deliberate nudge the needs_resend flag never had anything attached to.
// Only usable on an invoice already flagged needs_resend (i.e. it was sent
// before and its numbers changed since); this deliberately bypasses
// sendManualReminder's needs_resend block, which exists to stop a routine
// reminder going out on stale numbers, not to stop this explicit "yes, tell
// them" action.
export async function sendInvoiceUpdateNotice(invoiceId: string): Promise<{ error: string } | { success: true }> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, needs_resend')
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!invoice) return { error: 'Invoice not found' }
  if (!invoice.needs_resend) return { error: 'This invoice has not changed since it was last sent.' }

  const result = await sendInvoiceCore(supabase, schoolId, invoiceId)
  if ('error' in result) return result

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.update_notice_sent',
    targetType: 'invoice',
    targetId: invoiceId,
    summary: `Sent update notice for invoice to ${result.studentName}`,
    metadata: { studentId: result.studentId, channelsUsed: result.channelsUsed },
  })

  revalidatePath(`/students/${result.studentId}`)
  return { success: true as const }
}
