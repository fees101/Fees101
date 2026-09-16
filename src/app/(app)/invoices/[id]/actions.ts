'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { MessageChannel } from '@/lib/messaging/types'
import { sendInvoiceCore } from '@/lib/invoicing/sendInvoice'
import { sendReceiptCore } from '@/lib/invoicing/sendReceipt'
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

export async function sendReceipt(
  invoiceId: string
): Promise<{ error: string } | { success: true; channelsUsed: MessageChannel[]; to: string; preview: string }> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const result = await sendReceiptCore(supabase, schoolId, invoiceId)
  if ('error' in result) return result

  revalidatePath(`/invoices/${invoiceId}`)

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.receipt_sent',
    targetType: 'invoice',
    targetId: invoiceId,
    summary: `Sent a payment receipt via ${result.channelsUsed.join(', ') || 'no channel'}`,
    metadata: { channelsUsed: result.channelsUsed },
  })

  return {
    success: true,
    channelsUsed: result.channelsUsed,
    to: result.to,
    preview: result.preview,
  }
}

export async function cancelInvoice(
  invoiceId: string
): Promise<{ error: string } | { success: true }> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_amount, paid_amount, credit_applied, student_id, billing_cycle_id, billing_cycles(status), students(first_name, last_name)')
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!invoice) return { error: 'Invoice not found.' }
  if (invoice.status === 'cancelled') return { error: 'This invoice is already cancelled.' }
  if (invoice.status === 'paid') return { error: 'A fully paid invoice cannot be cancelled.' }
  // Money already landed on this invoice (part-payment or credit) — cancelling
  // it outright would silently orphan that money. The admin needs to sort out
  // a refund or credit adjustment first, not have this button do it for them.
  if (Number(invoice.paid_amount || 0) > 0 || Number(invoice.credit_applied || 0) > 0) {
    return { error: 'This invoice has a payment or credit applied — resolve that first (refund or credit adjustment) before cancelling.' }
  }

  // Mirrors requestDiscount's guard: a closed-term invoice whose balance has
  // already carried forward onto a successor invoice is no longer the live
  // record of what's owed — cancelling it here wouldn't reduce anything the
  // student actually owes (that lives on the successor now) and would leave
  // that successor's previous_balance_from_invoice_id pointing at a
  // cancelled row.
  if ((invoice.billing_cycles as any)?.status === 'closed') {
    const { data: successor } = await supabase
      .from('invoices')
      .select('id, billing_cycles(name)')
      .eq('previous_balance_from_invoice_id', invoiceId)
      .eq('school_id', schoolId)
      .maybeSingle()
    if (successor) {
      const cycleName = (successor.billing_cycles as any)?.name
      return {
        error: `This balance carried forward to ${cycleName || 'a later term'} — cancel or adjust that invoice instead. Cancelling this one won't reduce what's actually owed.`,
      }
    }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'cancelled', needs_resend: false })
    .eq('id', invoiceId)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
  revalidatePath(`/students/${invoice.student_id}`)
  revalidatePath('/fees')
  revalidatePath('/fees/cycles')
  if (invoice.billing_cycle_id) revalidatePath(`/fees/cycles/${invoice.billing_cycle_id}`)

  const student = invoice.students as unknown as { first_name: string; last_name: string } | null
  const studentName = student ? `${student.first_name} ${student.last_name}`.trim() : invoice.student_id
  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'invoice.cancelled',
    targetType: 'invoice',
    targetId: invoiceId,
    summary: `Cancelled ${invoice.invoice_number ? `invoice ${invoice.invoice_number}` : 'an invoice'} for ${studentName} (₦${Number(invoice.total_amount).toLocaleString()}, unpaid)`,
    metadata: { studentId: invoice.student_id, totalAmount: Number(invoice.total_amount) },
  })

  return { success: true }
}

