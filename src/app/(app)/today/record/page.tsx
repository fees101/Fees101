import { redirect } from 'next/navigation'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getActivityFeed } from '@/lib/queries/activity'
import ActivityFeed from '@/components/activity/ActivityFeed'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Record' }

interface PageProps {
  searchParams: Promise<{
    category?: string
    range?: string
    search?: string
    page?: string
    perPage?: string
  }>
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default async function ActivityPage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-activity')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="today" title="Today" />
        <AccessDenied ctx={ctx} permissionKey="see-activity" />
      </>
    )
  }
  const showFinancials = can(ctx, 'see-financial-totals')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const perPage = parseInt(sp.perPage || '50', 10) || 50
  // App Shell defaults the Record to the last 7 days; "Term" scopes to the
  // active billing cycle and "All" removes the date bound entirely.
  const range: '7' | 'term' | 'all' = sp.range === 'all' ? 'all' : sp.range === 'term' ? 'term' : '7'

  // The active term's start date backs the "Term" preset.
  const { data: activeCycle } = await ctx.supabase
    .from('billing_cycles')
    .select('start_date')
    .eq('school_id', ctx.schoolId || '')
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .single()
  const termFrom = activeCycle?.start_date ? String(activeCycle.start_date).slice(0, 10) : ''

  const from = range === 'all' ? undefined : range === 'term' ? termFrom || undefined : isoDaysAgo(7)

  const { rows, total, aggregate } = await getActivityFeed({
    category: sp.category,
    from,
    search: sp.search,
    page,
    perPage,
  }, showFinancials)

  return (
    <>
      <WorkspaceHeader workspaceKey="today" title="Today" />

      <div className="px-4 sm:px-7 py-7">
        <ActivityFeed
          rows={rows}
          total={total}
          page={page}
          perPage={perPage}
          category={sp.category || 'all'}
          range={range}
          search={sp.search || ''}
          schoolId={ctx.schoolId ?? ''}
          aggregate={aggregate}
          termFrom={termFrom}
          showFinancials={showFinancials}
        />
      </div>
    </>
  )
}
