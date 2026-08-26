import { NextRequest, NextResponse } from 'next/server'
import { buildReport } from '@/lib/reports/reports'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { FINANCIAL_REPORT_TYPES } from '@/lib/auth/permissionCatalog'

// Streams a report as a downloadable CSV. All scope selection happens via query
// params; the builder module runs the queries scoped to the caller's school.
// Dynamic (reads auth cookies) and never cached.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const type = sp.get('type') || ''

  // This is a raw route handler — not covered by page guards or middleware —
  // so it must enforce permissions itself. The audit log is gated on its own
  // permission, separate from the rest of the Reports page.
  const ctx = await getAuthContext()
  if (type === 'audit-log') {
    if (!can(ctx, 'see-audit-log')) {
      return NextResponse.json({ error: 'Not authorized to download the audit log.' }, { status: 403 })
    }
  } else {
    if (!can(ctx, 'see-reports')) {
      return NextResponse.json({ error: 'Not authorized to download reports.' }, { status: 403 })
    }
  }
  const canFinancials = can(ctx, 'see-financial-totals')
  if (type !== 'audit-log' && FINANCIAL_REPORT_TYPES.has(type) && !canFinancials) {
    return NextResponse.json({ error: 'Not authorized to see financial figures.' }, { status: 403 })
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const { filename, csv } = await buildReport(
      type,
      {
        cycleId: sp.get('cycleId') || undefined,
        sessionId: sp.get('sessionId') || undefined,
        from: sp.get('from') || undefined,
        to: sp.get('to') || undefined,
        status: sp.get('status') || undefined,
      },
      today,
      { includeFinancials: canFinancials },
    )

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to build report' },
      { status: 400 },
    )
  }
}
