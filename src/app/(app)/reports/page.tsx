import { getReportScope, getReportDownloads } from '@/lib/reports/reports'
import ReportsLayout from '@/components/reports/ReportsLayout'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const [{ sessions, cycles }, downloads] = await Promise.all([
    getReportScope(),
    getReportDownloads(),
  ])

  return (
    <main className="px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <ReportsLayout sessions={sessions} cycles={cycles} downloads={downloads} />
      </div>
    </main>
  )
}
