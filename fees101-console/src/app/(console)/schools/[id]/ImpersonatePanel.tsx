import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import ImpersonateButton from './ImpersonateButton'

// "View as this school (read-only)" — lets a platform admin assume a
// specific existing school_admin's visibility inside fees101-web, read-only,
// for up to 45 minutes. See startImpersonation() in ./actions.ts for the
// session bookkeeping and ../../../fees101-web/src/lib/auth/permissions.ts
// for how fees101-web picks the session up and enforces read-only.
export default async function ImpersonatePanel({ schoolId }: { schoolId: string }) {
  const supabase = createServiceRoleClient()

  const { data: owner } = await supabase
    .from('users')
    .select('name, email')
    .eq('school_id', schoolId)
    .eq('role', 'school_admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!owner) return null

  return (
    <div className="panel" style={{ padding: 20, marginBottom: 24 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Impersonation</p>
      <p style={{ fontSize: 13.5, fontWeight: 600 }}>View as {owner.name || owner.email}</p>
      <p style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2, marginBottom: 14 }}>
        Read-only, for 45 minutes. Logged to the platform audit trail.
      </p>
      <ImpersonateButton schoolId={schoolId} />
    </div>
  )
}
