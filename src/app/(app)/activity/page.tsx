import { redirect } from 'next/navigation'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getActivityFeed } from '@/lib/queries/activity'
import ActivityFeed from '@/components/activity/ActivityFeed'

interface PageProps {
  searchParams: Promise<{
    category?: string
    from?: string
    to?: string
    search?: string
    page?: string
    perPage?: string
  }>
}

export default async function ActivityPage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-activity')) redirect('/dashboard')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const perPage = parseInt(sp.perPage || '50', 10) || 50

  const { rows, total } = await getActivityFeed({
    category: sp.category,
    from: sp.from,
    to: sp.to,
    search: sp.search,
    page,
    perPage,
  })

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-navy">Recent activity</h1>
          <p className="text-gray-500 text-sm mt-1">
            Everything happening in your account — payments received, invoices sent, messages to
            parents, and discount decisions.
          </p>
        </div>

        <ActivityFeed
          rows={rows}
          total={total}
          page={page}
          perPage={perPage}
          category={sp.category || 'all'}
          from={sp.from || ''}
          to={sp.to || ''}
          search={sp.search || ''}
        />
      </div>
    </main>
  )
}
