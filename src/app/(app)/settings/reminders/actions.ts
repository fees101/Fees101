'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'

async function getContext() {
  // Gated on the 'manage-reminder-config' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-reminder-config')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId }
}

export async function saveReminderSettings(form: {
  enabled: boolean
  advanceDays: number | null
  dueDayEnabled: boolean
  overdueEnabled: boolean
  overdueIntervalUnit: 'minutes' | 'days'
  overdueIntervalValue: number
  overdueMaxReminders: number | null
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  if (form.advanceDays !== null && (!Number.isInteger(form.advanceDays) || form.advanceDays < 1)) {
    return { error: 'Advance reminder days must be a positive whole number' }
  }
  if (!Number.isInteger(form.overdueIntervalValue) || form.overdueIntervalValue < 1) {
    return { error: 'Overdue reminder interval must be a positive whole number' }
  }
  if (form.overdueMaxReminders !== null && (!Number.isInteger(form.overdueMaxReminders) || form.overdueMaxReminders < 1)) {
    return { error: 'Max overdue reminders must be a positive whole number' }
  }

  const { data: existing } = await supabase
    .from('schools')
    .select('settings')
    .eq('id', schoolId)
    .single()

  const nextSettings = {
    ...(existing?.settings || {}),
    reminders: {
      enabled: form.enabled,
      advanceDays: form.advanceDays,
      dueDayEnabled: form.dueDayEnabled,
      overdueEnabled: form.overdueEnabled,
      overdueIntervalMinutes: form.overdueIntervalValue * (form.overdueIntervalUnit === 'days' ? 1440 : 1),
      overdueIntervalUnit: form.overdueIntervalUnit,
      overdueIntervalValue: form.overdueIntervalValue,
      overdueMaxReminders: form.overdueMaxReminders,
    },
  }

  const { error } = await supabase
    .from('schools')
    .update({ settings: nextSettings })
    .eq('id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/settings/reminders')
  return { success: true }
}
