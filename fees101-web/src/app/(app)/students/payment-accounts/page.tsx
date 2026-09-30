import { redirect } from 'next/navigation'
import PaymentAccountsFlow from '@/components/students/PaymentAccountsFlow'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getPaymentSettings } from '@/lib/queries/payments'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Payment accounts' }

export const dynamic = 'force-dynamic'

export default async function PaymentAccountsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-payment-config')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="students" title="Students" />
        <AccessDenied ctx={ctx} permissionKey="manage-payment-config" />
      </>
    )
  }

  const settings = await getPaymentSettings()

  return (
    <>
      <WorkspaceHeader
        workspaceKey="students"
        title="Students"
      />
      <div className="px-4 sm:px-7 py-7">
        <PaymentAccountsFlow
          provider={settings?.provider ?? null}
          isConfigured={settings?.isConfigured ?? false}
          dvaCount={settings?.dvaCount ?? 0}
          studentsWithoutDvaCount={settings?.studentsWithoutDvaCount ?? 0}
        />
      </div>
    </>
  )
}
