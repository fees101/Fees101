import { notFound } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import ReminderSettingsForm from '@/components/settings/ReminderSettingsForm'
import { getReminderSettings } from '@/lib/queries/reminders'

export default async function RemindersSettingsPage() {
  const settings = await getReminderSettings()
  if (!settings) notFound()

  return (
    <SettingsPageShell title="Reminders" subtitle="Configure automatic SMS reminders for unpaid invoices">
      <ReminderSettingsForm settings={settings} />
    </SettingsPageShell>
  )
}
