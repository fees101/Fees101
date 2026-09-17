import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getClassDrilldown, getFeeDrilldown } from '@/lib/queries/analytics'

// Backs the student list behind a fee/class row on the /payments page (see
// PaymentsDashboard's DrilldownModal). GET, not a server action, so the
// client-side chart/table click handlers can fetch it directly.
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext()
  if (!ctx || !can(ctx, 'see-analytics')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const cycleIds = (searchParams.get('cycleIds') || '').split(',').filter(Boolean)
  const className = searchParams.get('className')
  const feeName = searchParams.get('feeName')

  const rows = feeName
    ? await getFeeDrilldown(cycleIds, feeName)
    : className
      ? await getClassDrilldown(cycleIds, className)
      : []

  return NextResponse.json({ rows })
}
