import { NextRequest, NextResponse } from 'next/server'
import { buildReport } from '@/lib/reports/reports'

// Streams a report as a downloadable CSV. All scope selection happens via query
// params; the builder module runs the queries scoped to the caller's school.
// Dynamic (reads auth cookies) and never cached.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const type = sp.get('type') || ''

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
