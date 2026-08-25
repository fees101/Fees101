import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import PaymentSettingsForm from '@/components/settings/PaymentSettingsForm'
import { getPaymentSettings } from '@/lib/queries/payments'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function PaymentsSettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-payment-config')) redirect('/dashboard')

  const settings = await getPaymentSettings()
  if (!settings) notFound()

  // Build the school-scoped webhook URL from the incoming request so it's
  // correct in dev, preview, and prod without needing an env var.
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  const webhookUrl = `${proto}://${host}/api/webhooks/monnify/${settings.schoolId}`

  return (
    <SettingsPageShell title="Payments" subtitle="Connect your payment provider to accept fees online">
      <PaymentSettingsForm settings={settings} webhookUrl={webhookUrl} />
    </SettingsPageShell>
  )
}
