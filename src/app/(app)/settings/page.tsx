import { notFound } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import SchoolProfileForm from '@/components/settings/SchoolProfileForm'
import { getSchoolSettings } from '@/lib/queries/school'

export default async function SettingsPage() {
  const school = await getSchoolSettings()
  if (!school) notFound()

  return (
    <SettingsPageShell title="Settings" subtitle="Manage your school preferences and configuration">
      <SchoolProfileForm school={school} />
    </SettingsPageShell>
  )
}
