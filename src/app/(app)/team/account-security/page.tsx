import SettingsPageShell from '@/components/settings/SettingsPageShell'
import AccountSecurityForm from '@/components/settings/AccountSecurityForm'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Account security' }

export default function AccountSecurityPage() {
  return (
    <SettingsPageShell workspaceKey="team" title="Security" subtitle="Password and sign-in security">
      <AccountSecurityForm />
    </SettingsPageShell>
  )
}
