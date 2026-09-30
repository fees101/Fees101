import { notFound, redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import DiscountSettingsForm from '@/components/settings/DiscountSettingsForm'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import AccessDenied from '@/components/layout/AccessDenied'
import { getDiscountSettings } from '@/lib/queries/discounts'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Discount policy' }

export default async function DiscountsSettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-discount-config')) {
    return (
      <SettingsPageShell workspaceKey="school" title="Discount policy">
        <AccessDenied ctx={ctx} permissionKey="manage-discount-config" padded={false} />
      </SettingsPageShell>
    )
  }

  const settings = await getDiscountSettings()
  if (!settings) notFound()

  const { data: actor } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()

  return (
    <SettingsPageShell workspaceKey="school" title="Discount policy">
      {ctx.schoolId && (
        // Config lives on the school row; another admin editing it refreshes here.
        <RealtimeRefresh subscriptions={[{ table: 'schools', filter: `id=eq.${ctx.schoolId}` }]} />
      )}
      <DiscountSettingsForm settings={settings} actorName={actor?.name || 'You'} />
    </SettingsPageShell>
  )
}
