import { notFound, redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import ReminderSettingsForm from '@/components/settings/ReminderSettingsForm'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import AccessDenied from '@/components/layout/AccessDenied'
import { getReminderSettings } from '@/lib/queries/reminders'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Reminders' }

export default async function RemindersSettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-reminder-config')) {
    return (
      <SettingsPageShell workspaceKey="school" title="Reminders">
        <AccessDenied ctx={ctx} permissionKey="manage-reminder-config" padded={false} />
      </SettingsPageShell>
    )
  }

  const settings = await getReminderSettings()
  if (!settings) notFound()

  const { data: actor } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()

  return (
    <SettingsPageShell workspaceKey="school" title="Reminders">
      {ctx.schoolId && (
        // Config lives on the school row; another admin editing it refreshes here.
        <RealtimeRefresh subscriptions={[{ table: 'schools', filter: `id=eq.${ctx.schoolId}` }]} />
      )}
      <ReminderSettingsForm settings={settings} actorName={actor?.name || 'You'} />
    </SettingsPageShell>
  )
}
