'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { sendMessageWithFallback } from '@/lib/messaging/sendMessage'
import { MessageChannel } from '@/lib/messaging/types'
import { composeInvoiceSMS } from '@/lib/messaging/composeInvoice'
import { getSchoolSmsName } from '@/lib/messaging/schoolSmsName'

async function getContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: userProfile } = await supabase.from('users').select('school_id, role').eq('id', user.id).single()
  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase.from('schools').select('id').limit(1).single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return null
  return { supabase, schoolId }
}

export async function sendInvoice(invoiceId: string, channelOverride?: MessageChannel) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: inv } = await supabase
    .from('invoices')
    .select(`
      id, total_amount, paid_amount, outstanding_amount, status,
      students!inner(id, first_name, last_name, provider_dva_account_number, provider_dva_bank_name,
        families(primary_parent_name, primary_parent_phone, primary_parent_email)),
      billing_cycles!inner(name, due_date)
    `)
    .eq('id', invoiceId)
    .eq('school_id', schoolId)
    .single()

  if (!inv) return { error: 'Invoice not found' }
  if (inv.status === 'cancelled') return { error: 'This invoice is cancelled.' }

  const student: any = inv.students
  const family: any = student?.families
  const parentPhone: string | undefined = family?.primary_parent_phone
  if (!parentPhone) return { error: 'No parent phone number on file for this student.' }
  if (!student.provider_dva_account_number || !student.provider_dva_bank_name) {
    return { error: 'No payment account provisioned for this student yet.' }
  }
  const dueDate: string | undefined = (inv.billing_cycles as any)?.due_date
  if (!dueDate) return { error: 'This billing cycle has no due date set.' }

  const { data: school } = await supabase.from('schools').select('name, settings').eq('id', schoolId).single()

  const outstanding = Number(
    inv.outstanding_amount ?? (Number(inv.total_amount) - Number(inv.paid_amount || 0))
  )

  const messageParams = {
    studentName: `${student.first_name} ${student.last_name}`.trim(),
    termName: (inv.billing_cycles as any)?.name || '',
    amountDue: outstanding,
    accountNumber: student.provider_dva_account_number,
    bankName: student.provider_dva_bank_name,
    dueDate,
  }
  const smsText = composeInvoiceSMS({ ...messageParams, schoolName: getSchoolSmsName(school) })

  const result = await sendMessageWithFallback(
    { supabase, schoolId, messageType: 'invoice', studentId: student.id, invoiceId },
    { phone: parentPhone },
    { sms: smsText },
    { channelOrder: channelOverride ? [channelOverride] : undefined }
  )

  if (!result.ok) return { error: 'Failed to send on every available channel — check the notification banner for details.' }

  // Light the dormant "sent" machinery: mark sent, clear the resend flag.
  await supabase
    .from('invoices')
    .update({ sent_at: new Date().toISOString(), needs_resend: false })
    .eq('id', invoiceId)
    .eq('school_id', schoolId)

  revalidatePath(`/invoices/${invoiceId}`)
  return { success: true, channelUsed: result.channelUsed, to: parentPhone, preview: smsText }
}
