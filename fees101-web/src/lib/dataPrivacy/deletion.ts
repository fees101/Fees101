import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// ---------------------------------------------------------------------------
// Scheduled-deletion lookup. Shared by the login action and the (app) layout so
// a school that has closed its account gets a specific, dated message ("...
// scheduled for deletion on <date>. Contact support to cancel.") rather than the
// generic "your account has been deactivated" bounce.
//
// Reads via the service role: the caller is often mid-login (no usable session
// yet) or already-deactivated, and this row is written service-side anyway.
// ---------------------------------------------------------------------------

export interface ScheduledDeletion {
  scheduledFor: string
  requestedAt: string
}

export async function getScheduledDeletion(
  schoolId: string | null | undefined,
): Promise<ScheduledDeletion | null> {
  if (!schoolId) return null
  try {
    const svc = createServiceRoleClient()
    const { data } = await svc
      .from('school_deletion_requests')
      .select('scheduled_for, created_at')
      .eq('school_id', schoolId)
      .eq('status', 'scheduled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!data) return null
    return { scheduledFor: data.scheduled_for, requestedAt: data.created_at }
  } catch {
    // Never let this lookup block a login/redirect path — fall back to the
    // generic deactivation message if the check itself fails.
    return null
  }
}
