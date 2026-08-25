import { notFound, redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import ReminderSettingsForm from '@/components/settings/ReminderSettingsForm'
import { getReminderSettings } from '@/lib/queries/reminders'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function RemindersSettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-reminder-config')) redirect('/dashboard')

  const settings = await getReminderSettings()
  if (!settings) notFound()

  return (
    <SettingsPageShell title="Reminders" subtitle="Configure automatic SMS reminders for unpaid invoices">
      <ReminderSettingsForm settings={settings} />
    </SettingsPageShell>
  )
}
