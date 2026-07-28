import { notFound } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import DiscountSettingsForm from '@/components/settings/DiscountSettingsForm'
import { getDiscountSettings } from '@/lib/queries/discounts'

export default async function DiscountsSettingsPage() {
  const settings = await getDiscountSettings()
  if (!settings) notFound()

  return (
    <SettingsPageShell title="Discounts" subtitle="Configure sibling discount tiers and the default staff-child discount">
      <DiscountSettingsForm settings={settings} />
    </SettingsPageShell>
  )
}
