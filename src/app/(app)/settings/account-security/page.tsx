import SettingsPageShell from '@/components/settings/SettingsPageShell'
import AccountSecurityForm from '@/components/settings/AccountSecurityForm'

export default function AccountSecurityPage() {
  return (
    <SettingsPageShell title="Account security" subtitle="Password and sign-in security">
      <AccountSecurityForm />
    </SettingsPageShell>
  )
}
