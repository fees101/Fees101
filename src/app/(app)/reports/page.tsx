import { redirect } from 'next/navigation'
import { getReportScope, getReportDownloads } from '@/lib/reports/reports'
import ReportsLayout from '@/components/reports/ReportsLayout'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import { getAuthContext, can } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const ctx = await getAuthContext()
  const showReports = can(ctx, 'see-reports')
  const showAuditLog = can(ctx, 'see-audit-log')
  if (!showReports && !showAuditLog) redirect('/dashboard')
  const showFinancials = can(ctx, 'see-financial-totals')

  const [{ sessions, cycles }, downloads] = await Promise.all([
    getReportScope(),
    getReportDownloads(),
  ])

  return (
    <main className="px-6 py-6">
      <div className="max-w-5xl mx-auto">
        {ctx?.schoolId && (
          // The downloads list grows as reports finish generating (async) or
          // another staff member generates one.
          <RealtimeRefresh subscriptions={[{ table: 'report_downloads', filter: `school_id=eq.${ctx.schoolId}` }]} />
        )}
        <ReportsLayout
          sessions={sessions}
          cycles={cycles}
          downloads={downloads}
          showFinancials={showFinancials}
          showReports={showReports}
          showAuditLog={showAuditLog}
        />
      </div>
    </main>
  )
}
