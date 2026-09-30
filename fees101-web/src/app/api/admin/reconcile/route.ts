import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { reconcileSchool } from '@/lib/payments/reconcile'

async function runReconcile() {
  const supabase = createServiceRoleClient()

  const { data: schools } = await supabase
    .from('schools')
    .select('id')
    .in('payment_provider', ['monnify', 'paystack'])

  const results = []
  for (const school of schools || []) {
    results.push(await reconcileSchool(school.id, supabase))
  }

  return results
}

// No user session applies here (same class of caller as the webhook —
// whatever ends up scheduling this: a cron host, a manual trigger, etc.),
// so this protects itself with a shared secret rather than relying on
// middleware, consistent with every other /api route.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-reconcile-secret')
  if (!secret || secret !== process.env.RECONCILE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ results: await runReconcile() })
}

// Vercel Cron invokes with GET and sends the project's CRON_SECRET env var
// as a bearer token automatically once it's set — see vercel.json for the
// schedule.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ results: await runReconcile() })
}
