'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAnonClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getScheduledDeletion } from '@/lib/dataPrivacy/deletion'
import { PRIVACY_CONTACT_EMAIL, formatDeletionDate } from '@/lib/dataPrivacy/config'
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
    return { error: error.message }
  }

  await recordLoginAttempt(email, true)

  // A school that has closed its account gets a specific, dated message rather
  // than the generic deactivation bounce it would otherwise hit in the layout.
  const userId = signIn.user?.id
  if (userId) {
    const svc = createServiceRoleClient()
    const { data: profile } = await svc
      .from('users')
      .select('school_id')
      .eq('id', userId)
      .single()
    const scheduled = await getScheduledDeletion(profile?.school_id)
    if (scheduled) {
      await supabase.auth.signOut()
      return {
        error: `This school account is scheduled for deletion on ${formatDeletionDate(
          scheduled.scheduledFor,
        )}. Contact ${PRIVACY_CONTACT_EMAIL} to cancel.`,
      }
    }
  }

  redirect('/dashboard')
}

// Self-service "forgot password" — same resetPasswordForEmail() call an admin
// already triggers on a staff member's behalf from Settings → Users
// (settings/users/actions.ts:resetStaffPassword), just reachable by the
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
