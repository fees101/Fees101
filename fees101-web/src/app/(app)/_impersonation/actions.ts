'use server'

import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Manual end of a "view as this school" session, triggered from the
// ImpersonationBanner's "End session" button. Natural expiry (45 minutes)
// needs no code here — once expires_at passes, current_school_id() and
// loadAuthContext() both stop finding the session on the next request and
// fall straight through to normal (fallback-free) denial.
export async function endImpersonation() {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.isImpersonating || !ctx.impersonationSessionId) {
    redirect('/login')
  }

  const svc = createServiceRoleClient()

  const { data: session } = await svc
    .from('impersonation_sessions')
    .select('platform_admin_name, target_school_name')
    .eq('id', ctx.impersonationSessionId)
    .maybeSingle()

  await svc
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString(), ended_reason: 'manual' })
    .eq('id', ctx.impersonationSessionId)

  // Platform-side trail only — this is the real platform admin's own action,
  // never attributed to (or smeared into) the impersonated school's own
  // audit_log.
  await svc.from('platform_audit_log').insert({
    actor_id: ctx.userId,
    actor_name: session?.platform_admin_name || 'Platform admin',
    action: 'impersonation.ended',
    school_id: ctx.schoolId,
    summary: `Ended the impersonation session viewing ${session?.target_school_name || 'a school'}`,
    metadata: { impersonationSessionId: ctx.impersonationSessionId },
  })

  // ctx.supabase is this same request's server client, still carrying the
  // platform admin's own session — sign it out so the next request has no
  // session at all (rather than leaving the admin's own, now session-less,
  // identity sitting around with nothing to fall back to).
  await ctx.supabase.auth.signOut()

  redirect('/login')
}
