import { redirect } from 'next/navigation'
import { getAllCycles } from '@/lib/queries/fees'
import { previewCloseTerm } from '@/app/(app)/fees/cycles/actions'
import CloseTermLedger from '@/components/fees/CloseTermLedger'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Close term' }

// Close term is a first-class Fees tab in the redesign (it was a figures-free
// modal buried in cycle detail). It targets the active term by default; the
// Cycles lifecycle can deep-link a specific term via ?cycle= (e.g. a draft an
// admin wants to skip). Both entry points land on the same pre-run ledger.
export const maxDuration = 60

interface PageProps {
  searchParams: Promise<{ cycle?: string; activateAfter?: string }>
}

export default async function CloseTermPage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-fee-structure')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="fees" title="Close term" />
        <AccessDenied ctx={ctx} permissionKey="manage-fee-structure" />
      </>
    )
  }
  const showFinancials = can(ctx, 'see-financial-totals')

  const sp = await searchParams
  const cycles = await getAllCycles()

  // The term to close: an explicitly deep-linked one (if still open), else the
  // active term. A closed term can't be closed again, so it never qualifies.
  const requested = sp.cycle ? cycles.find(c => c.id === sp.cycle && c.status !== 'closed') : undefined
  const target = requested || cycles.find(c => c.status === 'active') || null

  // Cycles can send ?activateAfter=<draftId> when activating that draft would
  // otherwise close this term as an invisible side effect — closing here
  // first, reviewed on its own terms, then activating the draft once it's
  // done. Only honoured if that draft still exists and is still a draft.
  const activateAfterCycle = sp.activateAfter
    ? cycles.find(c => c.id === sp.activateAfter && c.status === 'draft')
    : undefined

  const preview = target ? await previewCloseTerm(target.id) : null

  return (
    <>
      {ctx.schoolId && (
        <RealtimeRefresh
          subscriptions={[
            { table: 'billing_cycles', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'invoices', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'payments', filter: `school_id=eq.${ctx.schoolId}` },
          ]}
        />
      )}

      <WorkspaceHeader workspaceKey="fees" title="Close term" />

      <div className="px-4 sm:px-7 py-7">
        {!target || !preview || 'error' in preview ? (
          <div style={{ maxWidth: 880 }}>
            <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
              <h2 style={{ fontSize: 25, fontWeight: 800, margin: '0 0 6px', color: 'var(--color-ink)' }}>
                No open term to close
              </h2>
              <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--color-neutral-800)', margin: '0 0 16px', maxWidth: '72ch' }}>
                {preview && 'error' in preview
                  ? preview.error
                  : 'There is no active term right now. Activate a term from Cycles first — closing a term is what carries its unpaid balances onto the next one.'}
              </p>
              <Link href="/fees/cycles" className="m-btn m-btn-outline">Go to Cycles</Link>
            </div>
          </div>
        ) : (
          <CloseTermLedger
            cycle={target}
            preview={preview}
            showFinancials={showFinancials}
            activateAfter={activateAfterCycle ? { id: activateAfterCycle.id, name: activateAfterCycle.name } : null}
          />
        )}
      </div>
    </>
  )
}
