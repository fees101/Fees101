import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS entirely. This dashboard reads across
// every school by design (it's the founder's own tool), so nearly every
// query in this app goes through this client rather than a per-user session.
if (typeof window !== 'undefined') {
  throw new Error('serviceRole.ts was imported client-side — it holds a key that bypasses all RLS and must stay server-only.')
}

export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
