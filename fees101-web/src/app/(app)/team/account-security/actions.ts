'use server'

import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/logAudit'

export async function changePassword(form: {
  currentPassword: string
  newPassword: string
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return { error: 'Not authenticated' }

  if (!form.currentPassword) return { error: 'Current password is required' }
  if (form.newPassword.length < 8) return { error: 'New password must be at least 8 characters' }

  // Supabase has no standalone "verify password" call — re-authenticate to confirm it.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: form.currentPassword,
  })
  if (verifyError) return { error: 'Current password is incorrect' }

  const { error: updateError } = await supabase.auth.updateUser({ password: form.newPassword })
  if (updateError) return { error: updateError.message }

  // Supabase's own "Password changed" notification email (Authentication →
  // Emails) fires automatically on this updateUser() call — no custom send
  // needed here.
  const { data: userRow } = await supabase.from('users').select('school_id').eq('id', user.id).single()
  if (userRow?.school_id) {
    await logAuditEvent(supabase, {
      schoolId: userRow.school_id,
      actorId: user.id,
      action: 'account.password_changed',
      targetType: 'user',
      targetId: user.id,
      summary: 'Changed their own password',
    })
  }

  return { success: true }
}
