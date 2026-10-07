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
    from?: string
    to?: string
    search?: string
    page?: string
    perPage?: string
  }>
}

function isoDaysAgo(days: number): string {
  // Lagos-anchored, not the server's local TZ — keeps this in sync with the
  // client-side label in ActivityFeed.tsx (same helper, same fix, see there).
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000)
  lagosNow.setUTCDate(lagosNow.getUTCDate() - days)
  return lagosNow.toISOString().slice(0, 10)
}

// Monday of the current Lagos week, for the "This week" preset. Same pure
// UTC+1 arithmetic as isoDaysAgo so server and client never disagree on the day.
function isoWeekStart(): string {
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000)
  const dow = lagosNow.getUTCDay() // 0 = Sunday … 6 = Saturday
  const daysFromMonday = (dow + 6) % 7
  lagosNow.setUTCDate(lagosNow.getUTCDate() - daysFromMonday)
  return lagosNow.toISOString().slice(0, 10)
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

  // Explicit from/to dates define a custom window and win over any preset. With
  // no custom dates, the Record defaults to the active TERM (a school's natural
  // window) rather than the last 7 days; an explicit ?range= always wins, and
  // with no active term to scope to it falls back to 7 days.
  const hasCustom = !!(sp.from || sp.to)
  type Range = '7' | 'term' | 'all' | 'today' | 'week' | 'custom'
  const range: Range = hasCustom
    ? 'custom'
    : sp.range === 'all' ? 'all'
      : sp.range === '7' ? '7'
        : sp.range === 'term' ? 'term'
          : sp.range === 'today' ? 'today'
            : sp.range === 'week' ? 'week'
              : termFrom ? 'term' : '7'

  let from: string | undefined
  let to: string | undefined
  if (hasCustom) {
    from = sp.from || undefined
    to = sp.to || undefined
  } else if (range === 'all') {
    from = undefined
  } else if (range === 'term') {
    from = termFrom || undefined
  } else if (range === 'today') {
    from = isoDaysAgo(0)
    to = isoDaysAgo(0)
  } else if (range === 'week') {
    from = isoWeekStart()
  } else {
    from = isoDaysAgo(7)
  }

  const { rows, total, aggregate } = await getActivityFeed({
    category: sp.category,
    from,
    to,
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
          from={from || ''}
          to={to || ''}
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
