import Sidebar from '@/components/layout/Sidebar'
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
    if (scheduled) {
      // The date, so the login screen's generic notice can still say when —
      // this passive path (a stale session hitting a page, not a fresh sign-
      // in) can't prove the visitor is the owner, so it never gets the
      // "cancel" affordance; only a credential-based sign-in can (see
      // login/actions.ts's login()).
      redirect(`/logout?error=scheduled_deletion&until=${encodeURIComponent(scheduled.scheduledFor)}`)
    }
    // uid: so the bounce screen can look up and name who deactivated this
    // account and when (getDeactivationDetails in login/actions.ts).
    redirect(`/logout?error=account_deactivated&uid=${encodeURIComponent(authCtx.userId)}`)
  }
  const { supabase, userId, schoolId, role, isOwner } = authCtx

  // getAuthContext() already retries its own profile lookup against the same
  // flaky proxy (see permissions.ts) — this display-only query needs the same
  // treatment, it just wasn't written with it. A transient failure here must
  // not throw on the first hiccup; retry a few times before giving up.
  //
  // The schools(...) embed must be qualified by FK name: schools now has two
  // paths from users (users.school_id -> schools.id, and the newer
  // schools.keys_rotated_by -> users.id audit column), so an unqualified
  // "schools(...)" is ambiguous to PostgREST (PGRST201) and fails every time,
  // not just on transient errors — retries alone can never fix this half.
  async function loadDisplayProfile() {
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('users')
        .select('name, email, schools!users_school_id_fkey(name, logo_url), roles(name)')
        .eq('id', userId)
        .maybeSingle()
      if (!error) return data
      lastError = error
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
    }
    console.error('loadDisplayProfile failed after retries:', lastError)
    return null
  }

  const [
    profile,
    { data: currentCycle },
    { data: notificationRows },
    { data: jobRows },
    { count: studentsCount },
    { count: pendingDiscountsCount },
  ] = await Promise.all([
    loadDisplayProfile(),
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
    // Sidebar counts, school-scoped and permission-agnostic (RLS already limits
    // to this school; the rail only shows a count next to a workspace the role
    // can reach). Active roster size, and the pending-discount queue depth.
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId || '')
      .eq('status', 'active'),
    supabase
      .from('discounts')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId || '')
      .eq('status', 'pending'),
  ])

  // getAuthContext() already validated the JWT and loaded the user row, so a
  // null here (after loadDisplayProfile's own retries above) means either the
  // row genuinely vanished mid-request or the proxy stall outlasted 3 retries
  // — rare enough now that surfacing it beats masking it. Throw rather than
  // redirect('/login'): the middleware would bounce a still-valid session back
  // to /today, and we'd loop (ERR_TOO_MANY_REDIRECTS). An error/reload is
  // the correct, non-looping failure mode.
  if (!profile) throw new Error('AppLayout: profile display query failed for an authenticated user')

  // Sidebar workspace counts (read-only, school-scoped). Money is the invoices
  // issued in the active term (matches the Today "Invoices issued" figure);
  // Students is the active roster; Discounts is the pending-approval queue
  // (already fetched above). streamCount is today's activity (payments taken +
  // invoices generated today), the "N today" the STREAM footer shows.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayIso = todayStart.toISOString()
  const [
    { count: invoicesIssuedCount },
    { count: paymentsTodayCount },
    { count: invoicesTodayCount },
  ] = await Promise.all([
    currentCycle
      ? supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', schoolId || '')
          .eq('billing_cycle_id', currentCycle.id)
          .neq('status', 'cancelled')
      : Promise.resolve({ count: 0 }),
    supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId || '')
      .eq('match_status', 'matched')
      .gte('paid_at', todayIso),
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId || '')
      .gte('generated_at', todayIso),
  ])

  const navCounts: Record<string, number> = {
    students: studentsCount || 0,
    money: invoicesIssuedCount || 0,
    discounts: pendingDiscountsCount || 0,
  }
  const streamCount = (paymentsTodayCount || 0) + (invoicesTodayCount || 0)

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
    bulk_send: '/money/invoices',
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
    <div className="min-h-screen bg-[var(--color-paper)] flex">
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
            notifications={notifications}
            navCounts={navCounts}
            streamCount={streamCount}
          />
          {/* pt-14 clears the fixed mobile top bar; the desktop rail is in-flow. */}
          <main className="flex-1 min-w-0 pt-14 lg:pt-0">
            {children}
          </main>
        </ActiveJobsProvider>
      </PermissionsProvider>
    </div>
  )
}