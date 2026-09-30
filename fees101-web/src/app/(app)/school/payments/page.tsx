import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import PaymentSettingsForm from '@/components/settings/PaymentSettingsForm'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import AccessDenied from '@/components/layout/AccessDenied'
import { getPaymentSettings } from '@/lib/queries/payments'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Payment settings' }

export default async function PaymentsSettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-payment-config')) {
    return (
      <SettingsPageShell workspaceKey="school" title="Payments">
        <AccessDenied ctx={ctx} permissionKey="manage-payment-config" padded={false} />
      </SettingsPageShell>
    )
  }

  const settings = await getPaymentSettings()
  if (!settings) notFound()

  const { data: actor } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()

  // Build the base webhook origin from the incoming request so it's correct in
  // dev, preview, and prod without needing an env var. The form appends the
  // provider + school id (it varies with the selected provider).
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  const webhookBase = `${proto}://${host}/api/webhooks`

  return (
    <SettingsPageShell workspaceKey="school" title="Payments">
      {ctx.schoolId && (
        <RealtimeRefresh
          subscriptions={[
            // DVA counts fall as background virtual-account provisioning fills
            // students; provider config itself lives on the school row.
            { table: 'students', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'schools', filter: `id=eq.${ctx.schoolId}` },
          ]}
        />
      )}
      <PaymentSettingsForm settings={settings} webhookBase={webhookBase} actorName={actor?.name || 'You'} />
    </SettingsPageShell>
  )
}
