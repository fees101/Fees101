'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { getScheduledDeletion } from '@/lib/dataPrivacy/deletion'
import { PRIVACY_CONTACT_EMAIL, formatDeletionDate } from '@/lib/dataPrivacy/config'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { data: signIn, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

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
