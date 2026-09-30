import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role Supabase client — bypasses RLS entirely. Only for trusted
// server-side code with no user session (webhook handlers, background jobs).
// The service key must never reach a browser bundle, so this throws
// immediately if the module is ever evaluated client-side rather than
// relying on nobody accidentally importing it from a 'use client' file.
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
