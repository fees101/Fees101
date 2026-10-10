import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import { getAuthContext, can } from '@/lib/auth/permissions'
import {
  getRefundsFeatureState,
  getPendingRefunds,
  getDecidedRefunds,
} from '@/lib/queries/refunds'
import RefundsWorkspace from '@/components/refunds/RefundsWorkspace'
import RefundLiabilityGate from '@/components/refunds/RefundLiabilityGate'

export const metadata: Metadata = { title: 'Refunds' }

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

export default async function RefundsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')

  const canRequest = can(ctx, 'request-refunds')
  const canApprove = can(ctx, 'approve-refunds')
  if (!canRequest && !canApprove) {
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Refunds" />
        <AccessDenied ctx={ctx} label="request or approve refunds" />
      </>
    )
  }

  const feature = await getRefundsFeatureState()

  // Self-serve: every school can reach this page (permission-gated above).
  // Only gate left is the owner's one-time liability acceptance.
  if (!feature.liabilityAccepted) {
    if (ctx.isOwner) {
      // Names the school's own connected provider in the liability note
      // (Paystack vs Monnify) rather than always assuming Paystack.
      const { data: school } = await ctx.supabase
        .from('schools')
        .select('payment_provider')
        .eq('id', ctx.schoolId)
        .maybeSingle()
      return (
        <>
          <WorkspaceHeader workspaceKey="money" title="Refunds" />
          <RefundLiabilityGate version={feature.currentVersion} provider={school?.payment_provider ?? null} />
        </>
      )
    }
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Refunds" />
        <Notice title="Refunds are not ready yet">
          The school owner needs to review and accept a short responsibility note before refunds can be processed
          here. Ask them to sign in and open this page.
        </Notice>
      </>
    )
  }

  const [{ pending, total }, decided] = await Promise.all([
    getPendingRefunds(),
    getDecidedRefunds(),
  ])

  return (
    <>
      {/* Money's full tab bar (Invoices/Collections/Reports/Refunds/Manual
          payments) stays visible here — folding Refunds into Money as a mode
          (2026-10-09) means this is one of several Money tabs, not its own
          workspace, so hiding the bar would strand the viewer with no way
          back to the other Money tabs. RefundsWorkspace's own Pending/History
          toggle below is a second, independent tab row — the same two-tier
          pattern Collections already uses (Money tabs, then its own
          Position/Breakdown/Forecast sub-tabs). */}
      <WorkspaceHeader workspaceKey="money" title="Refunds" />
      {ctx.schoolId && (
        <RealtimeRefresh
          subscriptions={[{ table: 'refunds', filter: `school_id=eq.${ctx.schoolId}` }]}
        />
      )}
      <RefundsWorkspace
        pending={pending}
        total={total}
        decided={decided}
        canApprove={canApprove}
      />
    </>
  )
}
