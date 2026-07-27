import { createClient } from '@/lib/supabase/server'

export interface ReminderSettings {
  schoolId: string
  enabled: boolean
  // Days before the due date to send a reminder. null = advance reminders off.
  advanceDays: number | null
  dueDayEnabled: boolean
  overdueEnabled: boolean
  // Source of truth for the repeat gate in reminders.ts (real elapsed time,
  // not calendar days) — lets the same interval be set in minutes for a fast
  // test cycle or days for real schools. overdueIntervalUnit/Value are just
  // the display pair the settings form round-trips; they don't affect logic.
  overdueIntervalMinutes: number
  overdueIntervalUnit: 'minutes' | 'days'
  overdueIntervalValue: number
  // Stop sending overdue reminders after this many. null = no cap.
  overdueMaxReminders: number | null
}

export const DEFAULT_REMINDER_SETTINGS: Omit<ReminderSettings, 'schoolId'> = {
  enabled: true,
  advanceDays: 3,
  dueDayEnabled: true,
  overdueEnabled: true,
  overdueIntervalMinutes: 7 * 1440,
  overdueIntervalUnit: 'days',
  overdueIntervalValue: 7,
  overdueMaxReminders: null,
}

async function getSchoolId() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }
  return schoolId
}

// Merges a school's stored settings.reminders JSON over the defaults — schools
// that haven't configured anything yet get the same behavior reminders.ts used
// to hardcode.
export function mergeReminderSettings(schoolId: string, stored: any): ReminderSettings {
  return { schoolId, ...DEFAULT_REMINDER_SETTINGS, ...(stored || {}) }
}

export async function getReminderSettings(): Promise<ReminderSettings | null> {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return null

  const { data: school } = await supabase
    .from('schools')
    .select('settings')
    .eq('id', schoolId)
    .single()

  if (!school) return null

  return mergeReminderSettings(schoolId, school.settings?.reminders)
}
