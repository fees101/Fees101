import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { reconcileSchool } from '@/lib/payments/reconcile'

// No user session applies here (same class of caller as the webhook —
// whatever ends up scheduling this: a cron host, a manual trigger, etc.),
// so this protects itself with a shared secret rather than relying on
// middleware, consistent with every other /api route.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-reconcile-secret')
  if (!secret || secret !== process.env.RECONCILE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  const { data: schools } = await supabase
    .from('schools')
    .select('id')
    .eq('payment_provider', 'monnify')

  const results = []
  for (const school of schools || []) {
    results.push(await reconcileSchool(school.id, supabase))
  }

  return NextResponse.json({ results })
}
