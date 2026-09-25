import { redirect } from 'next/navigation'
import { getReportScope, getReportDownloads, getReportDownloadHistory } from '@/lib/reports/reports'
import ReportsLayout from '@/components/reports/ReportsLayout'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Reports' }

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ page?: string; perPage?: string; reportType?: string }>
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  const showReports = can(ctx, 'see-reports')
  const showAuditLog = can(ctx, 'see-audit-log')
  if (!showReports && !showAuditLog) {
    return (
      <>
        <WorkspaceHeader workspaceKey="money" title="Reports" />
        <AccessDenied ctx={ctx} label="see reports or the audit log" />
      </>
    )
  }
  const showFinancials = can(ctx, 'see-financial-totals')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const perPage = parseInt(sp.perPage || '25', 10) || 25
  const reportType = sp.reportType || 'all'
  const access = { showReports, showFinancials, showAuditLog }

  const [{ sessions, cycles }, recentDownloads, history] = await Promise.all([
    getReportScope(),
    // Small, unfiltered — just enough to compute each report card's "last run".
    getReportDownloads(25, access),
    getReportDownloadHistory({ page, perPage, reportType }, access),
  ])

  return (
    <>
      <WorkspaceHeader workspaceKey="money" title="Reports" />
      <div className="px-4 sm:px-7 py-7">
        <div className="max-w-5xl mx-auto">
          {ctx?.schoolId && (
            // The downloads list grows as reports finish generating (async) or
            // another staff member generates one.
            <RealtimeRefresh subscriptions={[{ table: 'report_downloads', filter: `school_id=eq.${ctx.schoolId}` }]} />
          )}
          <ReportsLayout
            sessions={sessions}
            cycles={cycles}
            recentDownloads={recentDownloads}
            history={history.rows}
            historyTotal={history.total}
            page={page}
            perPage={perPage}
            reportType={reportType}
            showFinancials={showFinancials}
            showReports={showReports}
            showAuditLog={showAuditLog}
          />
        </div>
      </div>
    </>
  )
}
