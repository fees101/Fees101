import { redirect } from 'next/navigation'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getFlaggedPaymentsPage } from '@/lib/queries/flaggedPayments'
import FlaggedPaymentsList from '@/components/dashboard/FlaggedPaymentsList'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Flagged payments' }

const PER_PAGE = 25

// The full scoped list behind "N payments flagged for review" on Today. A
// modal doesn't scale past a handful of items, and the school needs to see
// each one's actual detail (and open the student/family it's about), so this
// is a real page — same pattern as /students?filter=unreachable and the
// invoices list's status filters, not another popup.
export default async function FlaggedPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-activity')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="today" title="Flagged payments" />
        <AccessDenied ctx={ctx} permissionKey="see-activity" />
      </>
    )
  }

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)

  const result = await getFlaggedPaymentsPage({ page, perPage: PER_PAGE })

  return (
    <>
      <WorkspaceHeader workspaceKey="today" title="Flagged payments" />
      <div className="px-4 sm:px-7 py-7">
        {'error' in result ? (
          <p className="text-sm text-[var(--color-neutral-700)]">{result.error}</p>
        ) : (
          <FlaggedPaymentsList
            initialRows={result.rows}
            total={result.total}
            page={page}
            perPage={PER_PAGE}
          />
        )}
      </div>
    </>
  )
}
