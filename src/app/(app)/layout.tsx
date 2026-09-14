import Sidebar from '@/components/layout/Sidebar'
import AdminNotificationBanner from '@/components/layout/AdminNotificationBanner'
import { getAuthContext, permissionList } from '@/lib/auth/permissions'
import { PermissionsProvider } from '@/lib/auth/PermissionsProvider'
import { ActiveJobsProvider } from '@/lib/jobs/ActiveJobsProvider'
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

  const [{ data: profile }, { data: currentCycle }, { data: notificationRows }, { data: jobRows }] = await Promise.all([
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
    // Re-attach a still-running job's progress bar after a hard reload/new
    // device (localStorage-only tracking loses it), and surface a job whose
    // owning tab is gone before it ever completed or failed. Bounded to the
    // last 24h — older interrupted jobs are effectively abandoned, not worth
    // resurfacing indefinitely.
    supabase
      .from('background_jobs')
      .select('id, job_type, status, payload, total, processed, failed, error, updated_at')
      .eq('school_id', schoolId || '')
      .in('status', ['running', 'failed'])
      .is('acknowledged_at', null)
      .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('updated_at', { ascending: false }),
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

  // Static per-job-type label/href so a job surfaced here (not started by
  // this browser) reads the same as one tracked live — see the trackJob call
  // sites for the labels this mirrors. cycleId-bearing job types link back to
  // the cycle that owns them; the rest link to their fixed home page.
  const JOB_LABELS: Record<string, string> = {
    invoice_generation: 'Invoice generation',
    invoice_regeneration: 'Invoice regeneration',
    csv_import: 'Importing students',
    bulk_dva: 'Creating payment accounts',
    bulk_send: 'Sending invoices',
    close_term: 'Carrying forward balances',
  }
  const JOB_HREFS: Record<string, string> = {
    csv_import: '/students/import',
    bulk_dva: '/students',
    bulk_send: '/invoices',
    close_term: '/fees/cycles',
  }
  const interruptedJobs = (jobRows || []).map(j => {
    const payload = (j.payload as Record<string, unknown>) || {}
    const cycleId = typeof payload.cycleId === 'string' ? payload.cycleId : null
    return {
      jobId: j.id,
      jobType: j.job_type,
      label: JOB_LABELS[j.job_type] || j.job_type,
      processed: j.processed,
      total: j.total,
      status: j.status as 'running' | 'failed',
      failed: j.failed,
      error: j.error,
      href: cycleId ? `/fees/cycles/${cycleId}` : JOB_HREFS[j.job_type],
    }
  })

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <PermissionsProvider permissions={permissions} isOwner={isOwner}>
        <ActiveJobsProvider interruptedJobs={interruptedJobs}>
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
        </ActiveJobsProvider>
      </PermissionsProvider>
    </div>
  )
}