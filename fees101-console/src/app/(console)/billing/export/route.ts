import { NextRequest, NextResponse } from 'next/server'
import { getPlatformAdmin } from '@/lib/auth'
import { getAllSchoolsBillingOverview } from '@/lib/accrual'

// CSV export for the per-school billing table — docs/platform-dashboard-architecture.md
// §4.3 explicitly calls for "exports for finance." Respects the same q/status
// filters as the on-screen table so "export what I'm looking at" works as
// expected. Bounded by school count (not a payments-row export), so no
// pagination needed here — same reasoning getAllSchoolsBillingOverview's own
// comment already gives for fetching every school in one pass.
function csvEscape(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  const admin = await getPlatformAdmin()
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim().toLowerCase()
  const status = searchParams.get('status') || ''

  const all = await getAllSchoolsBillingOverview()
  const rows = all.filter(r =>
    (!status || r.billingStatus === status) &&
    (!q || r.schoolName.toLowerCase().includes(q))
  )

  const header = ['School', 'Active students', 'Price per student per month', 'Billing path', 'Accrued this month', 'Billing status']
  const lines = [header.join(',')]
  rows.forEach(r => {
    lines.push([
      csvEscape(r.schoolName),
      csvEscape(r.activeStudentCount),
      csvEscape(r.pricePerStudentMonth.toFixed(2)),
      csvEscape(r.onAccrualPath ? 'Per-student accrual' : 'Legacy flat fee'),
      csvEscape(r.onAccrualPath ? r.monthToDateAccrued.toFixed(2) : ''),
      csvEscape(r.billingStatus),
    ].join(','))
  })

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fees101-billing-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
