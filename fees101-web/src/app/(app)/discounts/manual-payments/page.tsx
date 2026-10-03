import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import { getAuthContext, can } from '@/lib/auth/permissions'
import {
  getManualPaymentFeatureState,
  getPendingManualPayments,
  getDecidedManualPayments,
} from '@/lib/queries/manualPayments'
import ManualPaymentsWorkspace from '@/components/manualPayments/ManualPaymentsWorkspace'
import ManualPaymentLiabilityGate from '@/components/manualPayments/ManualPaymentLiabilityGate'

export const metadata: Metadata = { title: 'Manual payments' }

const INK = 'var(--color-ink)'
const BODY = 'var(--color-neutral-800)'

// A plain, self-contained message state matching the app shell — no caution or
// warning banner styling.
function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 sm:px-7 py-7">
      <div className="py-2" style={{ maxWidth: '60ch' }}>
        <p className="text-[17px] font-bold mb-2" style={{ color: INK }}>{title}</p>
        <p className="text-[14px] leading-[1.55]" style={{ color: BODY }}>{children}</p>
      </div>
    </div>
  )
}

export default async function ManualPaymentsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')

  const canRecord = can(ctx, 'record-manual-payments')
  const canApprove = can(ctx, 'approve-manual-payments')
  if (!canRecord && !canApprove) {
    return (
      <>
        <WorkspaceHeader workspaceKey="discounts" title="Approvals" />
        <AccessDenied ctx={ctx} label="record or approve manual payments" />
      </>
    )
  }

  const feature = await getManualPaymentFeatureState()

  // Fees101 has not turned the feature on for this school.
  if (!feature.enabled) {
    return (
      <>
        <WorkspaceHeader workspaceKey="discounts" title="Approvals" />
        <Notice title="Manual payment entry is not available yet">
          Recording cash, POS and cheque payments is turned on for a school by Fees101. It is not switched on
          for this school. If you need it, reach out and we will set it up.
        </Notice>
      </>
    )
  }

  // Enabled, but the owner has not accepted the current responsibility note.
  if (!feature.liabilityAccepted) {
    if (ctx.isOwner) {
      return (
        <>
          <WorkspaceHeader workspaceKey="discounts" title="Approvals" />
          <ManualPaymentLiabilityGate version={feature.currentVersion} />
        </>
      )
    }
    return (
      <>
        <WorkspaceHeader workspaceKey="discounts" title="Approvals" />
        <Notice title="Manual payment entry is not ready yet">
          The school owner needs to review and accept a short responsibility note before cash, POS and cheque
          payments can be recorded here. Ask them to sign in and open this page.
        </Notice>
      </>
    )
  }

  const [pending, decided] = await Promise.all([
    getPendingManualPayments(),
    getDecidedManualPayments(),
  ])

  return (
    <>
      {/* showTabs is off so the header does not render the Approvals route-mode
          tabs here: the workspace below owns the single tab bar (Record /
          Pending / History), avoiding two competing tab bars on this page. */}
      <WorkspaceHeader workspaceKey="discounts" title="Approvals" showTabs={false} />
      {ctx.schoolId && (
        <RealtimeRefresh
          subscriptions={[{ table: 'manual_payment_requests', filter: `school_id=eq.${ctx.schoolId}` }]}
        />
      )}
      <ManualPaymentsWorkspace
        pending={pending}
        decided={decided}
        canRecord={canRecord}
        canApprove={canApprove}
      />
    </>
  )
}
