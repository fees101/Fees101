import { NextRequest, NextResponse } from 'next/server'
import { getPlatformAdmin } from '@/lib/auth'
import { getPlatformAuditLogAll, getAuditSeverity } from '@/lib/opsQueries'

// CSV export for the platform audit log — docs/platform-dashboard-architecture.md
// names this as an explicit unbuilt want. Respects the same actor/action/
// school/from/to filters as the on-screen table. Capped at 5000 rows by
// getPlatformAuditLogAll (see its own comment) — audit entries are
// hand-triggered founder actions, never a payment-scale table.
function csvEscape(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  const admin = await getPlatformAdmin()
  if (!admin) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const actor = searchParams.get('actor') || undefined
  const action = searchParams.get('action') || undefined
  const schoolId = searchParams.get('school') || undefined
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined

  const rows = await getPlatformAuditLogAll({ actor, action, schoolId, from, to })

  const header = ['When', 'Actor', 'Severity', 'Action', 'School', 'Summary']
  const lines = [header.join(',')]
  rows.forEach(r => {
    lines.push([
      csvEscape(new Date(r.createdAt).toISOString()),
      csvEscape(r.actorName),
      csvEscape(getAuditSeverity(r.action)),
      csvEscape(r.action),
      csvEscape(r.schoolName || ''),
      csvEscape(r.summary),
    ].join(','))
  })

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fees101-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
