'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAnonClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getScheduledDeletion } from '@/lib/dataPrivacy/deletion'
import { checkLoginRateLimit, recordLoginAttempt } from '@/lib/auth/loginRateLimit'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const rateLimit = await checkLoginRateLimit(email)
  if (rateLimit.locked) {
    return {
      error: `Too many failed attempts on this account. Try again in ${rateLimit.retryAfterMinutes} minute${rateLimit.retryAfterMinutes === 1 ? '' : 's'}.`,
    }
  }

  const { data: signIn, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    await recordLoginAttempt(email, false)
    // Deliberately vague: never says which of the two is wrong. Naming the
    // email as the problem would confirm to a stranger that the account
    // exists at all — this covers every credential failure the same way,
    // not just a wrong password.
    return { error: 'That email and password do not match.' }
  }

  await recordLoginAttempt(email, true)

  // A school that has closed its account gets a specific, dated message
  // (and, for the owner, a way to undo it) rather than the generic
  // deactivation bounce it would otherwise hit in the layout.
  const userId = signIn.user?.id
  if (userId) {
    const svc = createServiceRoleClient()
    const { data: profile } = await svc
      .from('users')
      .select('school_id, name, role, roles(is_admin)')
      .eq('id', userId)
      .single()
    const scheduled = await getScheduledDeletion(profile?.school_id)
    if (scheduled) {
      // Checked directly against role rather than the usual isOwner helper:
      // scheduling deletion deactivates every login on the school, including
      // the owner's, so the normal "isOwner requires is_active" rule would
      // make this permanently unreachable by the only person allowed to
      // cancel it. See team/data-privacy/actions.ts's cancelScheduledDeletion.
      const isOwnerIdentity =
        profile?.role === 'school_admin' ||
        profile?.role === 'super_admin' ||
        (profile as any)?.roles?.is_admin === true

      if (!isOwnerIdentity) {
        await supabase.auth.signOut()
        return {
          scheduledDeletion: {
            scheduledFor: scheduled.scheduledFor,
            isOwner: false,
          },
        }
      }

      // Owner: keep this session alive (deliberately not signing out) — the
      // login screen renders the "cancel the deletion" card next, and the
      // cancel action needs a live session to prove who's asking.
      return {
        scheduledDeletion: {
          scheduledFor: scheduled.scheduledFor,
          isOwner: true,
        },
      }
    }
  }

  redirect('/today')
}

// Looked up for the "access revoked" bounce card (?error=account_deactivated)
// so it can name who removed access and when, instead of a generic message.
// Reads via the service role since the caller has just been signed out by
// the time they land on this screen. Returns null on any miss (no matching
// audit entry, lookup error) — the caller falls back to generic copy.
export async function getDeactivationDetails(
  userId: string,
): Promise<{ actorName: string; date: string } | null> {
  if (!userId) return null
  try {
    const svc = createServiceRoleClient()
    const { data } = await svc
      .from('audit_log')
      .select('actor_name, created_at')
      .eq('target_type', 'user')
      .eq('target_id', userId)
      .eq('action', 'staff.deactivated')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!data) return null
    return { actorName: data.actor_name || 'An administrator', date: data.created_at }
  } catch {
    return null
  }
}

// Self-service "forgot password" — same resetPasswordForEmail() call an admin
// already triggers on a staff member's behalf from Settings → Users
// (team/users/actions.ts:resetStaffPassword), just reachable by the
// account owner directly from the login page. Always reports success,
// whether or not the email matches an account, so this can't be used to
// enumerate registered emails.
export async function forgotPassword(formData: FormData) {
  const email = (formData.get('email') as string || '').trim()
  if (!email) return { error: 'Enter your email address.' }

  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || 'https'
  const origin = `${proto}://${host}`

  const anon = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  await anon.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/set-password`,
  })

  return { success: true }
}
