import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

export interface PlatformAdminContext {
  id: string
  name: string
  email: string
  role: 'owner' | 'admin'
}

// Reuses the same Supabase Auth users as the schools-facing app — logging in
// here is just Supabase Auth, but access beyond that requires a matching row
// in platform_admins. Anyone can sign in with any Fees101 account; only an
// allowlisted admin id gets past this check. Add/remove admins by inserting
// or deleting rows in platform_admins directly (Supabase SQL editor) — there
// is no self-service invite flow for this dashboard, deliberately, since it
// only ever needs a handful of people.
export async function getPlatformAdmin(): Promise<PlatformAdminContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const service = createServiceRoleClient()
  const { data: admin } = await service
    .from('platform_admins')
    .select('id, name, email, role')
    .eq('id', user.id)
    .maybeSingle()

  return admin as PlatformAdminContext | null
}
