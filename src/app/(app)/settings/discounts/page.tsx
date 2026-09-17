import { notFound, redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import DiscountSettingsForm from '@/components/settings/DiscountSettingsForm'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import { getDiscountSettings } from '@/lib/queries/discounts'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function DiscountsSettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-discount-config')) redirect('/dashboard')

  const settings = await getDiscountSettings()
  if (!settings) notFound()

  return (
    <SettingsPageShell title="Discounts" subtitle="Configure sibling discount tiers and the default staff-child discount">
      {ctx.schoolId && (
        // Config lives on the school row; another admin editing it refreshes here.
        <RealtimeRefresh subscriptions={[{ table: 'schools', filter: `id=eq.${ctx.schoolId}` }]} />
      )}
      <DiscountSettingsForm settings={settings} />
    </SettingsPageShell>
  )
}
