'use server'

import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import {
  DELETION_GRACE_DAYS,
  FINANCIAL_RETENTION_YEARS,
  DELETION_ACKNOWLEDGEMENT,
} from '@/lib/dataPrivacy/config'

interface RequestDeletionInput {
  confirmName: string
  acknowledged: boolean
}

// Owner-initiated account closure. Schedules deletion, then immediately closes
// the account (deactivates every staff login for the school, mirroring the
// admin-deactivation kick-out) and signs the owner out. Recovery during the
// grace window is Fees101-side (admin), by design.
export async function requestAccountDeletion(input: RequestDeletionInput) {
  const ctx = await getAuthContext()
  if (!ctx) return { error: 'Not signed in.' }
  // Whole-school deletion is owner-only — deliberately not a delegable permission.
  if (!ctx.isOwner) return { error: 'Only the account owner can close the account.' }
  if (!ctx.schoolId) return { error: 'No school associated with this account.' }

  if (!input.acknowledged) {
    return { error: 'Please confirm you understand this action before continuing.' }
  }

  const svc = createServiceRoleClient()

  // Resolve the school name (for the type-to-confirm check and the snapshot) and
  // the requester's identity (snapshotted — the user row is deleted later).
  const [{ data: school }, { data: me }] = await Promise.all([
    svc.from('schools').select('name').eq('id', ctx.schoolId).single(),
    svc.from('users').select('name, email').eq('id', ctx.userId).single(),
  ])

  if (!school) return { error: 'School not found.' }

  const expected = school.name.trim().toLowerCase()
  const given = input.confirmName.trim().toLowerCase()
  if (!given || given !== expected) {
    return { error: 'The name you typed does not match your school name.' }
  }

  const now = new Date()
  const scheduledFor = new Date(now)
  scheduledFor.setDate(scheduledFor.getDate() + DELETION_GRACE_DAYS)
  const financialPurgeAt = new Date(now)
  financialPurgeAt.setFullYear(financialPurgeAt.getFullYear() + FINANCIAL_RETENTION_YEARS)

  // Create the scheduled request. The partial unique index guards against a
  // duplicate active request (23505 → already scheduled).
  const { error: insertErr } = await svc.from('school_deletion_requests').insert({
    school_id: ctx.schoolId,
    school_name: school.name,
    status: 'scheduled',
    requested_by: ctx.userId,
    requested_by_name: me?.name ?? null,
    requested_by_email: me?.email ?? null,
    acknowledgement: DELETION_ACKNOWLEDGEMENT,
    scheduled_for: scheduledFor.toISOString(),
    financial_purge_at: financialPurgeAt.toISOString(),
  })

  if (insertErr) {
    if (insertErr.code === '23505') {
      return { error: 'This account is already scheduled for deletion.' }
    }
    return { error: 'Could not schedule deletion. Please try again or contact support.' }
  }

  // Close the account now: every staff login for the school stops working via
  // the existing deactivation kick-out (layout checks is_active each request).
  await svc.from('users').update({ is_active: false }).eq('school_id', ctx.schoolId)

  // Record it in the audit log while the school still exists (best-effort).
  try {
    await svc.from('audit_log').insert({
      school_id: ctx.schoolId,
      actor_id: ctx.userId,
      actor_name: me?.name ?? 'Owner',
      action: 'account.deletion_scheduled',
      target_type: 'school',
      target_id: ctx.schoolId,
      summary: `Account closure scheduled for ${scheduledFor.toISOString().slice(0, 10)}`,
      metadata: { scheduled_for: scheduledFor.toISOString() },
    })
  } catch {
    // Non-fatal — the deletion request itself is the source of truth.
  }

  // Sign the owner out; they'll land on the login screen's scheduled-deletion state.
  await ctx.supabase.auth.signOut()

  return { success: true, scheduledFor: scheduledFor.toISOString() }
}
