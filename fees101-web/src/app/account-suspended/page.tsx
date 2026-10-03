import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import AccountSuspendedView from './AccountSuspendedView'

export const metadata = { title: 'Billing suspended · Fees101' }

// Hard-blocks app entry once the dunning ladder (dunning.ts) has walked a
// school to 'suspended'. Lives outside (app) so the gate in (app)/layout.tsx
// can redirect here without looping, mirroring /connect-billing.
export default async function AccountSuspendedPage() {
  const ctx = await getAuthContext()
  if (!ctx || !ctx.schoolId) redirect('/login')

  const svc = createServiceRoleClient()
  const [{ data: billing }, { data: school }] = await Promise.all([
    svc.from('platform_billing').select('billing_status').eq('school_id', ctx.schoolId).maybeSingle(),
    svc.from('schools').select('name').eq('id', ctx.schoolId).maybeSingle(),
  ])

  // Already resolved (paid, reactivated) — don't show the wall.
  if (billing?.billing_status !== 'suspended') redirect('/today')

  return <AccountSuspendedView schoolName={school?.name || 'your school'} isOwner={ctx.isOwner} />
}
