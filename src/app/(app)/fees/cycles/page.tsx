import { redirect } from 'next/navigation'
import CyclesLayout from '@/components/fees/CyclesLayout'
import { getAllCycles, getSessions } from '@/lib/queries/fees'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Cycles' }

// Server Actions invoked from this page (createTerm, closeTerm,
// closeTermAndCarryForward's synchronous portion, etc.) can run long for a
// large school — bump to Vercel Hobby's 60s ceiling instead of the platform
// default. Config only, no behavior change.
export const maxDuration = 60

export default async function CyclesPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-fee-structure')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="fees" title="Cycles" />
        <AccessDenied ctx={ctx} permissionKey="see-fee-structure" />
      </>
    )
  }
  const showFinancials = can(ctx, 'see-financial-totals')

  const [cycles, sessions] = await Promise.all([
    getAllCycles(),
    getSessions(),
  ])

  return (
    <>
      {ctx.schoolId && (
        <RealtimeRefresh
          subscriptions={[
            // Per-cycle collection totals move on payment webhooks; cycles
            // are created/closed by the rollover job or another admin.
            { table: 'billing_cycles', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'invoices', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'payments', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'sessions', filter: `school_id=eq.${ctx.schoolId}` },
          ]}
        />
      )}

      <WorkspaceHeader workspaceKey="fees" title="Cycles" />

      <div className="px-4 sm:px-7 py-7">
        <div>

          <CyclesLayout cycles={cycles} sessions={sessions} showFinancials={showFinancials} />

        </div>
      </div>
    </>
  )
}
