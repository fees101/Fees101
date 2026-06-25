'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getContext() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return null

  return { supabase, schoolId, userId: user.id }
}

// ============ SESSIONS ============

export async function createSession(form: {
  name: string
  startDate: string
  endDate: string
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const name = form.name.trim()
  if (!name) return { error: 'Session name is required' }
  if (!form.startDate || !form.endDate) return { error: 'Start and end dates are required' }
  if (new Date(form.endDate) <= new Date(form.startDate)) {
    return { error: 'End date must be after start date' }
  }

  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', name)
    .maybeSingle()
  if (existing) return { error: `A session named "${name}" already exists` }

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      school_id: schoolId,
      name,
      start_date: form.startDate,
      end_date: form.endDate,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  return { success: true, sessionId: data.id }
}

// ============ TERMS ============

export async function createTerm(form: {
  name: string
  startDate: string
  endDate: string
  dueDate: string
  sessionId?: string | null
  newSessionName?: string
  newSessionStart?: string
  newSessionEnd?: string
  rollForwardFromCycleId?: string | null
  activateImmediately?: boolean
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const name = form.name.trim()
  if (!name) return { error: 'Term name is required' }
  if (!form.startDate || !form.endDate) return { error: 'Start and end dates are required' }
  if (!form.dueDate) return { error: 'Due date is required' }
  if (new Date(form.endDate) <= new Date(form.startDate)) {
    return { error: 'End date must be after start date' }
  }
  if (new Date(form.dueDate) < new Date(form.startDate)) {
    return { error: 'Due date cannot be before start date' }
  }

  const { data: existing } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', name)
    .maybeSingle()
  if (existing) return { error: `A term named "${name}" already exists` }

  let sessionId: string | null = form.sessionId || null

  if (!sessionId && form.newSessionName) {
    const sessionResult = await createSession({
      name: form.newSessionName,
      startDate: form.newSessionStart || form.startDate,
      endDate: form.newSessionEnd || form.endDate,
    })
    if (sessionResult.error) return { error: sessionResult.error }
    sessionId = sessionResult.sessionId || null
  }

  if (form.activateImmediately) {
    await supabase
      .from('billing_cycles')
      .update({ status: 'closed' })
      .eq('school_id', schoolId)
      .eq('status', 'active')
  }

  const { data: newCycle, error } = await supabase
    .from('billing_cycles')
    .insert({
      school_id: schoolId,
      name,
      start_date: form.startDate,
      end_date: form.endDate,
      due_date: form.dueDate,
      session_id: sessionId,
      status: form.activateImmediately ? 'active' : 'draft',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  if (form.rollForwardFromCycleId && newCycle) {
    const { data: sourceFees } = await supabase
      .from('fee_items')
      .select('class_id, name, amount, is_mandatory, is_optional_extra, display_order')
      .eq('billing_cycle_id', form.rollForwardFromCycleId)
      .eq('school_id', schoolId)

    if (sourceFees && sourceFees.length > 0) {
      const newFees = sourceFees.map(f => ({
        school_id: schoolId,
        billing_cycle_id: newCycle.id,
        class_id: f.class_id,
        name: f.name,
        amount: f.amount,
        is_mandatory: f.is_mandatory,
        is_optional_extra: f.is_optional_extra,
        display_order: f.display_order || 0,
      }))
      await supabase.from('fee_items').insert(newFees)
    }
  }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  revalidatePath('/fees/structure')
  return { success: true, cycleId: newCycle?.id }
}

export async function updateTerm(id: string, form: {
  name: string
  startDate: string
  endDate: string
  dueDate: string
  sessionId?: string | null
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const name = form.name.trim()
  if (!name) return { error: 'Term name is required' }
  if (!form.dueDate) return { error: 'Due date is required' }
  if (new Date(form.endDate) <= new Date(form.startDate)) {
    return { error: 'End date must be after start date' }
  }
  if (new Date(form.dueDate) < new Date(form.startDate)) {
    return { error: 'Due date cannot be before start date' }
  }

  const { data: existing } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', name)
    .neq('id', id)
    .maybeSingle()
  if (existing) return { error: `A term named "${name}" already exists` }

  const { error } = await supabase
    .from('billing_cycles')
    .update({
      name,
      start_date: form.startDate,
      end_date: form.endDate,
      due_date: form.dueDate,
      session_id: form.sessionId || null,
    })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}

export async function activateTerm(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  await supabase
    .from('billing_cycles')
    .update({ status: 'closed' })
    .eq('school_id', schoolId)
    .eq('status', 'active')

  const { error } = await supabase
    .from('billing_cycles')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}

export async function closeTerm(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status === 'closed') return { error: 'Term is already closed' }

  const { error } = await supabase
    .from('billing_cycles')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}

export async function reopenTermAsDraft(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  
  // Only active terms can be moved back to draft. Closed terms are permanent.
  if (cycle.status === 'closed') {
    return { error: 'Closed terms cannot be reopened. Contact support if you need to recover a closed term.' }
  }
  if (cycle.status === 'draft') {
    return { error: 'Term is already a draft' }
  }

  // Check if any invoices have been SENT to parents.
  // If not sent, we can safely move back to draft.
  const { data: sentInvoices } = await supabase
    .from('invoices')
    .select('id')
    .eq('billing_cycle_id', id)
    .not('sent_at', 'is', null)
    .limit(1)

  if (sentInvoices && sentInvoices.length > 0) {
    return { error: 'Cannot move to draft — invoices have already been sent to parents for this term.' }
  }

  const { error } = await supabase
    .from('billing_cycles')
    .update({ status: 'draft', closed_at: null })
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}

export async function deleteTermDraft(id: string) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, status')
    .eq('id', id)
    .eq('school_id', schoolId)
    .single()

  if (!cycle) return { error: 'Term not found' }
  if (cycle.status !== 'draft') {
    return { error: 'Only draft terms can be deleted. Close the term first if needed.' }
  }

  const { count: invoiceCount } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('billing_cycle_id', id)

  if ((invoiceCount || 0) > 0) {
    return { error: `Cannot delete — ${invoiceCount} invoices already generated for this term` }
  }

  const { data: feeItems } = await supabase
    .from('fee_items')
    .select('id')
    .eq('billing_cycle_id', id)

  if (feeItems && feeItems.length > 0) {
    await supabase
      .from('student_fee_adjustments')
      .delete()
      .in('fee_item_id', feeItems.map(f => f.id))

    await supabase
      .from('fee_items')
      .delete()
      .eq('billing_cycle_id', id)
  }

  const { error } = await supabase
    .from('billing_cycles')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/fees/cycles')
  revalidatePath('/fees')
  return { success: true }
}