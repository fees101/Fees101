'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { startBulkSendInvoicesJob, sendInvoiceCore } from '@/lib/invoicing/sendInvoice'
import { logAuditEvent } from '@/lib/audit/logAudit'
import { getAllInvoicesForExport, type AllInvoicesOptions } from '@/lib/queries/fees'

async function getContext() {
  // Gated on the 'manage-invoices' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-invoices')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

// The CSV export mirrors whatever's currently filtered/searched in the list —
// gated on see-invoices (the same permission that shows the table itself),
// not manage-invoices, since exporting what you can already see isn't a
// change of any kind.
export async function exportInvoicesCSV(options: Omit<AllInvoicesOptions, 'page' | 'perPage'>) {
  const ctx = await requirePermission('see-invoices')
  if (!ctx) return { error: 'Not authenticated' }
  const rows = await getAllInvoicesForExport(options)
  return { success: true as const, rows }
}

// Starts a background_jobs 'bulk_send' job for every invoice that's never
// been sent, or was flagged needs_resend after being updated post-send.
// A never-sent invoice with nothing outstanding is skipped — there's nothing
// to remind the parent about; a needs_resend invoice is included regardless
// of balance, since the parent needs to hear about the change itself even if
// it nets to zero owed. The client polls via useTrackedJob (same as invoice
// generation / bulk DVA) instead of driving a client-side loop, so a school
// with hundreds/thousands of invoices can't get stuck re-sending a
// persistently-failing batch forever.
export async function startBulkSend(opts: { onlyNeedsResend?: boolean } = {}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx
  return startBulkSendInvoicesJob(supabase, schoolId, userId, opts)
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
