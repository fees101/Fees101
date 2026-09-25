import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth/permissions'
import { buildFullExport } from '@/lib/dataPrivacy/exportAll'

// Streams a full school-data export as a downloadable .zip of CSVs.
//
// Owner-only, matching the Data & privacy page itself: exporting a whole
// school's data is a different risk class from the per-report exports on the
// Reports page, so it is hardcoded to ctx.isOwner rather than a delegable
// permission. Raw route handler → enforces auth itself.
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getAuthContext()
  if (!ctx) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  if (!ctx.isOwner) {
    return NextResponse.json({ error: 'Only an account owner can export all data.' }, { status: 403 })
  }
  if (!ctx.schoolId) {
    return NextResponse.json({ error: 'No school is associated with this account.' }, { status: 400 })
  }

  try {
    const today = new Date().toISOString().slice(0, 10)
    const { filename, bytes } = await buildFullExport(ctx.schoolId, today)
    // Copy into a fresh ArrayBuffer so the body is a clean BodyInit.
    const body = new Uint8Array(bytes)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to build export' },
      { status: 400 },
    )
  }
}
