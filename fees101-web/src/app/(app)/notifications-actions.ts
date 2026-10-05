'use server'

import { revalidatePath } from 'next/cache'
import { getAuthContext } from '@/lib/auth/permissions'
import { FLAGGED_PAYMENT_NOTIFICATION_TYPES } from '@/lib/notifications/flaggedPaymentTypes'

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

// Clears the dashboard "Payments to review" aggregate in one go: marks every
// still-unread payment-anomaly notification for this school as read, using the
// same read_at mechanism the per-notification bell dismiss uses. The "Needs
// you" row is derived from the unread count of exactly these types, so it
// auto-clears on the next load once they're all marked read.
export async function dismissFlaggedPaymentNotifications() {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) return { error: 'Not authenticated' }

  const { error } = await ctx.supabase
    .from('admin_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('school_id', ctx.schoolId)
    .is('read_at', null)
    .in('type', FLAGGED_PAYMENT_NOTIFICATION_TYPES as unknown as string[])

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return { success: true }
}
