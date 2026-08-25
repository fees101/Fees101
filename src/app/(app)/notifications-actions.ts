'use server'

import { revalidatePath } from 'next/cache'
import { getAuthContext } from '@/lib/auth/permissions'

export async function dismissAdminNotification(notificationId: string) {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated' }

  const { error } = await ctx.supabase
    .from('admin_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('school_id', ctx.schoolId)

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return { success: true }
}
