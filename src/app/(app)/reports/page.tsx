import { redirect } from 'next/navigation'
import { getReportScope, getReportDownloads } from '@/lib/reports/reports'
import ReportsLayout from '@/components/reports/ReportsLayout'
import { getAuthContext, can } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const ctx = await getAuthContext()
  if (!can(ctx, 'see-reports')) redirect('/dashboard')
  const showFinancials = can(ctx, 'see-financial-totals')

  const [{ sessions, cycles }, downloads] = await Promise.all([
    getReportScope(),
    getReportDownloads(),
  ])

  return (
    <main className="px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <ReportsLayout sessions={sessions} cycles={cycles} downloads={downloads} showFinancials={showFinancials} />
      </div>
    </main>
  )
}
