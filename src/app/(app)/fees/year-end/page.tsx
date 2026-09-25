import { redirect } from 'next/navigation'
import { getRolloverStatus } from '@/app/(app)/fees/cycles/actions'
import type { Metadata } from 'next'
import {
  getPromotionPreviewAction,
  getClassesForOverrideAction,
  getDraftSessionsAction,
  getYearEndFeeCopyPreviewAction,
  getYearEndReadinessAction,
} from './actions'
import YearEndRolloverWizard from '@/components/fees/YearEndRolloverWizard'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Year end' }

// Server Actions invoked from this page (startYearEndRollover /
// resumeYearEndRollover -> continueYearEndRollover) still run their whole
// per-student promotion/adjustment/invoice-recompute pipeline as one call —
// bump the page's default Server Action timeout to Vercel Hobby's 60s
// ceiling (matches JOB_TIME_BUDGET_MS's 50s assumption elsewhere) instead of
// the platform default, which is well under what a large school's rollover
// needs. Config only — see the rollover cron-sweep item in ROADMAP.md for
// the actual timeout-can't-happen fix.
export const maxDuration = 60

export default async function YearEndPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'run-year-end')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="fees" title="Year end" />
        <AccessDenied ctx={ctx} permissionKey="run-year-end" />
      </>
    )
  }
  // Money figures (balances carried) are gated the same way every other Fees
  // surface gates them — a person who can run the rollover but can't see
  // financial totals gets the counts, not the naira.
  const showFinancials = can(ctx, 'see-financial-totals')

  const [statusResult, previewResult, classesResult, draftSessionsResult, feeCopyResult, readinessResult] =
    await Promise.all([
      getRolloverStatus(),
      getPromotionPreviewAction(),
      getClassesForOverrideAction(),
      getDraftSessionsAction(),
      getYearEndFeeCopyPreviewAction(),
      getYearEndReadinessAction(),
    ])

  const activeRun = ('run' in statusResult ? statusResult.run : null) || null
  const groups = 'groups' in previewResult ? previewResult.groups : []
  const classes = 'classes' in classesResult ? classesResult.classes : []
  const previewError = 'error' in previewResult ? previewResult.error : null
  const draftSessions = 'sessions' in draftSessionsResult ? draftSessionsResult.sessions : []
  const feeCopyPreview = 'preview' in feeCopyResult ? feeCopyResult.preview : null
  const readiness = 'readiness' in readinessResult ? readinessResult.readiness : null

  return (
    <>
      {ctx.schoolId && (
        <RealtimeRefresh
          subscriptions={[
            // The rollover runs as a long background job (cron-sweep advances
            // the rollover_runs row); this makes its progress show live. It
            // also creates cycles/sessions and promotes students as it goes.
            { table: 'rollover_runs', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'billing_cycles', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'sessions', filter: `school_id=eq.${ctx.schoolId}` },
          ]}
        />
      )}

      <WorkspaceHeader workspaceKey="fees" title="Year end" />

      <div className="px-4 sm:px-7 py-7">
        <YearEndRolloverWizard
          activeRun={activeRun}
          groups={groups}
          classes={classes}
          previewError={previewError}
          draftSessions={draftSessions}
          feeCopyPreview={feeCopyPreview}
          readiness={readiness}
          showFinancials={showFinancials}
        />
      </div>
    </>
  )
}
