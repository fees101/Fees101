import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import AccessDenied from '@/components/layout/AccessDenied'
import PlatformBillingForm from './PlatformBillingForm'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Platform billing' }

// How Fees101 collects its own fee from this school — separate from how this
// school collects fees from parents. Owner-only: the collection method is a
// liability decision (mandate vs manual transfer), not something a role
// should be able to flip.
export default async function PlatformBillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; switched?: string }>
}) {
  const params = await searchParams
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!ctx.isOwner) {
    return (
      <SettingsPageShell workspaceKey="team" title="Platform billing">
        <AccessDenied ctx={ctx} ownerOnly padded={false} />
      </SettingsPageShell>
    )
  }
  if (!ctx.schoolId) redirect('/login')

  const svc = createServiceRoleClient()
  const { data: billing } = await svc
    .from('platform_billing')
    .select(
      'billing_connected_at, billing_method, mandate_status, mandate_email, mandate_authorized_at, platform_dva_account_number, platform_dva_bank_name',
    )
    .eq('school_id', ctx.schoolId)
    .maybeSingle()

  if (!billing?.billing_connected_at) {
    redirect('/connect-billing')
  }

  return (
    <SettingsPageShell workspaceKey="team" title="Platform billing">
      <PlatformBillingForm
        billingMethod={billing.billing_method === 'dva' ? 'dva' : 'mandate'}
        mandateStatus={billing.mandate_status}
        mandateEmail={billing.mandate_email}
        mandateAuthorizedAt={billing.mandate_authorized_at}
        dvaAccountNumber={billing.platform_dva_account_number}
        dvaBankName={billing.platform_dva_bank_name}
        initialErrorCode={params.error ?? null}
        justSwitched={params.switched === 'mandate'}
      />
    </SettingsPageShell>
  )
}
