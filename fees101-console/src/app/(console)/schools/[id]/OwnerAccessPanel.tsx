import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import RegenerateLinkButton from './RegenerateLinkButton'
import PasswordResetButton from './PasswordResetButton'

export default async function OwnerAccessPanel({ schoolId }: { schoolId: string }) {
  const supabase = createServiceRoleClient()

  const { data: owner } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('school_id', schoolId)
    .eq('role', 'school_admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!owner?.email) return null

  const { data: authUser } = await supabase.auth.admin.getUserById(owner.id)
  const activated = !!(authUser?.user?.email_confirmed_at || authUser?.user?.last_sign_in_at)

  return (
    <div className="panel" style={{ padding: 20, marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Owner access</p>
        <span className={activated ? 'tag tag-good' : 'tag tag-warn'}>{activated ? 'Activated' : 'Not activated'}</span>
      </div>
      <p style={{ fontSize: 13.5, fontWeight: 600 }}>{owner.name || owner.email}</p>
      <p style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2, marginBottom: 14 }}>{owner.email}</p>
      {activated ? (
        <div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
            The owner has set a password and can log in. They normally use password reset in the app themselves &mdash;
            only send this if they&rsquo;ve asked us directly (e.g. called in locked out).
          </p>
          <PasswordResetButton schoolId={schoolId} />
        </div>
      ) : (
        <RegenerateLinkButton schoolId={schoolId} />
      )}
    </div>
  )
}
