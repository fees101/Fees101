'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { sendInvoice } from './[id]/actions'

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

type BulkSendResult =
  | { error: string }
  | { success: true; sent: number; failed: number; remaining: number; errors: { invoiceId: string; error: string }[] }

// Sends ONE batch of invoices that have never been sent, or were flagged
// needs_resend after being updated post-send, then reports how many still
// remain. The client calls this repeatedly (a batch at a time, with a
// progress bar) — same pattern as createDVAsForAllStudents — so a school
// with hundreds/thousands of invoices never runs as one giant request that
// would blow past a serverless function's execution timeout, and the SMTP
// bonus-email sends get naturally spread across multiple requests instead of
// firing in one burst against the mailbox's rate limit.
export async function bulkSendInvoices(batchSize = 20): Promise<BulkSendResult> {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const limit = Math.max(1, Math.min(batchSize, 50))
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id')
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
    .or('sent_at.is.null,needs_resend.eq.true')
    .limit(limit)

  if (error) return { error: error.message }

  let sent = 0
  const errors: { invoiceId: string; error: string }[] = []

  // Each send also fires a bonus PDF email — stagger requests slightly within
  // the batch so it doesn't slam the school's mailbox all at once.
  for (const inv of invoices || []) {
    const result = await sendInvoice(inv.id)
    if ('error' in result && result.error) {
      errors.push({ invoiceId: inv.id, error: result.error })
    } else {
      sent++
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  const { count: remaining } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
    .or('sent_at.is.null,needs_resend.eq.true')

  revalidatePath('/invoices')
  return { success: true, sent, failed: errors.length, remaining: remaining ?? 0, errors }
}
