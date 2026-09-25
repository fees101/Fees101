import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFeeStructure } from '@/lib/queries/fees'
import FeeStructureLayout from '@/components/fees/FeeStructureLayout'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Fee structure' }

interface PageProps {
  searchParams: Promise<{ view?: string, class?: string, cycle?: string }>
}

export default async function FeeStructurePage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-fee-structure')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="fees" title="Fee structure" />
        <AccessDenied ctx={ctx} permissionKey="see-fee-structure" />
      </>
    )
  }
  const showFinancials = can(ctx, 'see-financial-totals')

  const { view, class: classParam, cycle: cycleParam } = await searchParams

  const data = await getFeeStructure(cycleParam)

  const isClosedTerm = data?.cycle?.status === 'closed'

  return (
    <>
      {ctx.schoolId && (
        <RealtimeRefresh
          subscriptions={[
            // Fee structure edited by another staff member, plus per-student
            // overrides and the term/cycle status it's scoped to.
            { table: 'fee_items', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'student_fee_adjustments', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'billing_cycles', filter: `school_id=eq.${ctx.schoolId}` },
          ]}
        />
      )}

      <WorkspaceHeader
        workspaceKey="fees"
        title="Fee structure"
      />

      <div className="px-4 sm:px-7 py-7">
        <div>

          {isClosedTerm && (
            <div className="mb-6 pl-4 py-3 border-l-2 border-[var(--color-ink)] bg-[var(--color-surface)]">
              <p className="text-sm font-semibold text-[var(--color-ink)]">This term is closed</p>
              <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">
                Fee data is read-only. To make changes, go to <Link href="/fees/cycles" className="underline hover:text-[var(--color-ink)]">Billing cycles</Link> and reopen this term as a draft.
              </p>
            </div>
          )}

          {!data ? (
            <p className="text-sm text-[var(--color-neutral-700)]">Loading...</p>
          ) : (
            <FeeStructureLayout
              data={data}
              initialView={view === 'item' ? 'item' : 'class'}
              initialClassId={classParam}
              readOnly={isClosedTerm}
              showFinancials={showFinancials}
            />
          )}

        </div>
      </div>
    </>
  )
}
