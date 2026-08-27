import Sidebar from '@/components/layout/Sidebar'
import AdminNotificationBanner from '@/components/layout/AdminNotificationBanner'
import { getAuthContext, permissionList } from '@/lib/auth/permissions'
import { PermissionsProvider } from '@/lib/auth/PermissionsProvider'
import { getScheduledDeletion } from '@/lib/dataPrivacy/deletion'
import { redirect } from 'next/navigation'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Single auth/profile round-trip (React cache()'d) — every page below reuses
  // this exact result instead of each doing its own createClient()+getUser().
  const authCtx = await getAuthContext()
  if (!authCtx) redirect('/login')
  // Instant deactivation kick-out. Uses the is_active already resolved by
  // getAuthContext() (folded into this same cached round-trip — no extra DB
  // call), restoring the immediate bounce the middleware used to do, minus its
  // per-navigation lookup. A deactivated user also gets zero permissions, but
  // this stops them landing on any (app) page at all.
  if (!authCtx.isActive) {
    // Distinguish a self-closed account (scheduled for deletion → dated,
    // "contact support" message) from an admin deactivation (generic message).
    // Only pays the extra lookup on the already-rare bounce path. Route through
    // /logout so the session is actually cleared — a straight redirect to
    // /login would loop (middleware bounces a still-valid session back in).
    const scheduled = await getScheduledDeletion(authCtx.schoolId)
    redirect(scheduled ? '/logout?error=scheduled_deletion' : '/logout?error=account_deactivated')
  }
  const { supabase, userId, schoolId, role, isOwner } = authCtx

  const [{ data: profile }, { data: currentCycle }, { data: notificationRows }] = await Promise.all([
    supabase
      .from('users')
      .select('name, email, schools(name, logo_url), roles(name)')
      .eq('id', userId)
      .single(),
    supabase
      .from('billing_cycles')
      .select('id, name')
      .eq('school_id', schoolId || '')
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('admin_notifications')
      .select('id, title, body, created_at')
      .eq('school_id', schoolId || '')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (!profile) redirect('/login')

  // Prefer the assigned custom role's name (e.g. "Head Teacher") over the base
  // type (owner/school_admin, super_admin, or the generic 'bursar' base type
  // every non-owner staff member shares) — the base type alone is misleading
  // once a school has more than one custom role.
  // @ts-expect-error — roles is joined object
  const roleLabel: string = profile.roles?.name || role.replace('_', ' ')

  // Resolve the current user's permissions once, for both the sidebar (client)
  // and any page below (server, via the cached getAuthContext).
  const permissions = permissionList(authCtx)

  const notifications = (notificationRows || []).map(n => ({
    id: n.id,
    title: n.title,
    body: n.body,
    createdAt: n.created_at,
  }))

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <PermissionsProvider permissions={permissions} isOwner={isOwner}>
        <Sidebar
          userName={profile.name}
          userEmail={profile.email}
          userRole={roleLabel}
          // @ts-expect-error — schools is joined object
          schoolName={profile.schools?.name || 'Fees101'}
          // @ts-expect-error — schools is joined object
          schoolLogoUrl={profile.schools?.logo_url || null}
          currentTermName={currentCycle?.name || null}
          currentTermId={currentCycle?.id || null}
        />
        <main className="flex-1 min-w-0">
          <AdminNotificationBanner notifications={notifications} />
          {children}
        </main>
      </PermissionsProvider>
    </div>
  )
}