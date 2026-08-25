import { notFound, redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import SchoolProfileForm from '@/components/settings/SchoolProfileForm'
import { getSchoolSettings } from '@/lib/queries/school'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function SettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-school-profile')) redirect('/settings/account-security')

  const school = await getSchoolSettings()
  if (!school) notFound()

  return (
    <SettingsPageShell title="Settings" subtitle="Manage your school preferences and configuration">
      <SchoolProfileForm school={school} />
    </SettingsPageShell>
  )
}
