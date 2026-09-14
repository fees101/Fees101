'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { startBulkSendInvoicesJob } from '@/lib/invoicing/sendInvoice'

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
