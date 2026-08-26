'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/lib/audit/logAudit'

async function getContext() {
  // Gated on the 'manage-reminder-config' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-reminder-config')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
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
  const { supabase, schoolId, userId } = ctx

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

  const before = (existing?.settings || {}).reminders || null
  const after = {
    enabled: form.enabled,
    advanceDays: form.advanceDays,
    dueDayEnabled: form.dueDayEnabled,
    overdueEnabled: form.overdueEnabled,
    overdueIntervalMinutes: form.overdueIntervalValue * (form.overdueIntervalUnit === 'days' ? 1440 : 1),
    overdueIntervalUnit: form.overdueIntervalUnit,
    overdueIntervalValue: form.overdueIntervalValue,
    overdueMaxReminders: form.overdueMaxReminders,
  }

  const nextSettings = {
    ...(existing?.settings || {}),
    reminders: after,
  }

  const { error } = await supabase
    .from('schools')
    .update({ settings: nextSettings })
    .eq('id', schoolId)

  if (error) return { error: error.message }

  // Reminders were previously getting silently stuck "enabled" due to a
  // front-end persistence bug — call out the enabled flag specifically so
  // who-turned-reminders-off/on is easy to spot in the audit log.
  const enabledChanged = !before || before.enabled !== after.enabled
  const onlyEnabledChanged = !!before && enabledChanged &&
    Object.keys(after).every(k => k === 'enabled' || (before as any)[k] === (after as any)[k])

  let summary: string
  if (onlyEnabledChanged) {
    summary = after.enabled ? 'Turned on payment reminders' : 'Turned off payment reminders'
  } else if (enabledChanged) {
    summary = after.enabled ? 'Updated reminder settings and turned reminders on' : 'Updated reminder settings and turned reminders off'
  } else {
    summary = 'Updated reminder settings'
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'reminder_config.updated',
    targetType: 'school',
    targetId: schoolId,
    summary,
    metadata: { before, after, enabledChanged, enabled: after.enabled },
  })

  revalidatePath('/settings/reminders')
  return { success: true }
}
