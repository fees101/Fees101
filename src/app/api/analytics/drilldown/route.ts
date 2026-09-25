import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getClassDrilldown, getFeeDrilldown } from '@/lib/queries/analytics'

// Backs the student list behind a fee/class row on the /money/collections page (see
// PaymentsDashboard's DrilldownModal). GET, not a server action, so the
// client-side chart/table click handlers can fetch it directly.
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext()
  if (!ctx || !can(ctx, 'see-analytics')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // see-analytics only gates the trend/rate visuals; the raw naira figures
  // behind them are a separate see-financial-totals check. DrilldownModal's
  // amt() helper already masks these on render, but that's a UI-only mask —
  // the API must not put real amountOwed/amountPaid on the wire when the
  // caller lacks the permission, since a devtools/network read would bypass
  // the client-side mask entirely.
  const showFinancials = can(ctx, 'see-financial-totals')

  const { searchParams } = new URL(request.url)
  const cycleIds = (searchParams.get('cycleIds') || '').split(',').filter(Boolean)
  const className = searchParams.get('className')
  const feeName = searchParams.get('feeName')

  const rows = feeName
    ? await getFeeDrilldown(cycleIds, feeName)
    : className
      ? await getClassDrilldown(cycleIds, className)
      : []

  // Student identity and status still show (matching the "item shows, only
  // the naira figure redacts" convention used elsewhere) — only the two
  // money fields zero out.
  const safeRows = showFinancials ? rows : rows.map(r => ({ ...r, amountOwed: 0, amountPaid: 0 }))

  return NextResponse.json({ rows: safeRows })
}
