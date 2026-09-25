import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

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
  // Which channels a reminder goes out on. SMS is the only channel that
  // actually sends today, and can't be turned off — it's the one that
  // works. Email sends for real (Brevo) when a parent email is on file.
  // WhatsApp has no send path yet, so it's always off regardless of this flag.
  channels: { sms: true; email: boolean; whatsapp: boolean }
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
  channels: { sms: true, email: true, whatsapp: false },
}

async function getSchoolId() {
  const ctx = await getAuthContext()
  return ctx?.schoolId ?? null
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
