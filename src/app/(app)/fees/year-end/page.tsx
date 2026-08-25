import { redirect } from 'next/navigation'
import { getRolloverStatus } from '@/app/(app)/fees/cycles/actions'
import { getPromotionPreviewAction, getClassesForOverrideAction, getDraftSessionsAction } from './actions'
import YearEndRolloverWizard from '@/components/fees/YearEndRolloverWizard'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function YearEndPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'run-year-end')) redirect('/fees')

  const [statusResult, previewResult, classesResult, draftSessionsResult] = await Promise.all([
    getRolloverStatus(),
    getPromotionPreviewAction(),
    getClassesForOverrideAction(),
    getDraftSessionsAction(),
  ])

  const activeRun = ('run' in statusResult ? statusResult.run : null) || null
  const groups = 'groups' in previewResult ? previewResult.groups : []
  const classes = 'classes' in classesResult ? classesResult.classes : []
  const previewError = 'error' in previewResult ? previewResult.error : null
  const draftSessions = 'sessions' in draftSessionsResult ? draftSessionsResult.sessions : []

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-navy">Year-end rollover</h1>
        <p className="text-gray-500 mt-2 text-sm">
          Close the current term, promote students into their next class, and open a new academic year.
        </p>
      </header>

      <YearEndRolloverWizard
        activeRun={activeRun}
        groups={groups}
        classes={classes}
        previewError={previewError}
        draftSessions={draftSessions}
      />
    </div>
  )
}
