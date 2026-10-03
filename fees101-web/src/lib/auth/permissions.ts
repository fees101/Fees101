import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { PERMISSIONS, PERMISSION_KEYS } from './permissionCatalog'
import { IMPERSONATION_WRITE_ALLOWLIST } from './impersonationWriteAllowlist'

// ---------------------------------------------------------------------------
// Central auth/permission helper. Replaces the copy-pasted getContext() blocks
// scattered across actions/queries: one place that resolves the signed-in user,
// their school, and the set of permissions granted by their custom role.
//
// Owner (school_admin), Fees101 (super_admin) and any is_admin role are
// "owners" here — they bypass every permission check. Everyone else is granted
// exactly the switches their role has flipped on.
//
// Permissions are read live per request (memoized with React cache()), so an
// admin's toggle change takes effect on the user's very next request — no
// re-login, unlike a JWT-claims approach.
// ---------------------------------------------------------------------------

export interface AuthContext {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  schoolId: string | null
  role: string
  roleId: string | null
  isOwner: boolean
  permissions: Set<string>
  isActive: boolean
  // True while a platform admin is viewing this school read-only (see
  // impersonation_sessions / startImpersonation in fees101-console). userId
  // above stays the REAL platform admin's id throughout — it never becomes
  // the assumed user's id.
  isImpersonating: boolean
  impersonationSessionId: string | null
}

const SEE_PERMISSION_KEYS = new Set(PERMISSIONS.filter(p => p.group === 'SEE').map(p => p.key))

// Uncached loader. getAuthContext() wraps this in cache() for per-request reuse.
async function loadAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient()
  // Validate the JWT locally (getClaims) rather than a network round-trip to
  // the Auth server (getUser) — the middleware already gates access, and with
  // asymmetric signing keys this is signature-only. `claims.sub` is the user id.
  //
  // getClaims() still does its own key-fetch/verification work that can hit the
  // corporate proxy's flakiness (same issue the profile lookup below already
  // retries around) — a TRANSIENT error here must not be mistaken for "no
  // session" either, or a validly-authenticated user gets bounced to /login,
  // which middleware's own (separate, possibly-successful) getClaims() check
  // bounces straight back, producing the ERR_TOO_MANY_REDIRECTS loop.
  let claimsData: Awaited<ReturnType<typeof supabase.auth.getClaims>>['data'] = null
  let claimsError: { message?: string } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.auth.getClaims()
    if (!error) {
      claimsData = data
      claimsError = null
      break
    }
    claimsError = error
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
  }
  if (claimsError) {
    throw new Error(`getAuthContext: getClaims failed after retries: ${claimsError.message ?? 'unknown error'}`)
  }
  const userId = claimsData?.claims?.sub
  // No valid JWT → genuinely unauthenticated. This is the ONLY condition that
  // legitimately sends the caller down its `if (!ctx) redirect('/login')` path.
  if (!userId) return null

  // Platform-admin impersonation ("View as this school", started from
  // fees101-console). Checked via the service-role client because
  // impersonation_sessions has RLS enabled with NO policies — same pattern as
  // platform_admins/platform_billing/platform_audit_log — so it is never
  // reachable through the caller's own anon/authenticated session. Only a
  // platform admin's id can ever have a row here (console's startImpersonation
  // gates on requireAdmin() before inserting one), so finding an active,
  // unexpired session here IS the authorization.
  const svc = createServiceRoleClient()
  const { data: activeSession } = await svc
    .from('impersonation_sessions')
    .select('id, target_school_id, target_user_id')
    .eq('platform_admin_id', userId)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeSession?.target_user_id) {
    const { data: targetProfile } = await svc
      .from('users')
      .select('role, role_id, is_active, roles(is_admin, permissions)')
      .eq('id', activeSession.target_user_id)
      .maybeSingle()

    if (targetProfile) {
      const targetRoleRow = (targetProfile as { roles?: { is_admin?: boolean; permissions?: Record<string, boolean> } | null }).roles
      const targetIsOwner =
        targetProfile.role === 'super_admin' ||
        targetProfile.role === 'school_admin' ||
        targetRoleRow?.is_admin === true
      const targetActive = targetProfile.is_active !== false

      // What the assumed user could normally do, computed exactly like the
      // non-impersonating path below.
      const assumedPermissions = new Set<string>()
      if (targetActive) {
        if (targetIsOwner) {
          for (const k of PERMISSION_KEYS) assumedPermissions.add(k)
        } else if (targetRoleRow?.permissions) {
          for (const k of PERMISSION_KEYS) {
            if (targetRoleRow.permissions[k] === true) assumedPermissions.add(k)
          }
        }
      }
      // Read-only: intersect down to SEE-group keys only. can() below adds a
      // second, belt-and-suspenders block on top of this for DO-group keys.
      const readOnlyPermissions = new Set<string>(
        [...assumedPermissions].filter((k) => SEE_PERMISSION_KEYS.has(k))
      )

      return {
        supabase,
        userId, // the REAL platform admin's id — never the assumed user's.
        schoolId: activeSession.target_school_id,
        role: targetProfile.role,
        roleId: (targetProfile.role_id as string | null) ?? null,
        isOwner: false,
        permissions: readOnlyPermissions,
        isActive: true,
        isImpersonating: true,
        impersonationSessionId: activeSession.id,
      }
    }
  }

  // Profile enrichment. A TRANSIENT failure here (the corporate proxy makes
  // outbound Supabase calls slow/flaky) must not be mistaken for "no session":
  // returning null would send a validly-authenticated user to /login, which the
  // middleware — whose getClaims() JWT check still passes — bounces straight
  // back to /today, producing the ERR_TOO_MANY_REDIRECTS loop.
  //
  // maybeSingle() (not single()) so zero rows come back as data:null/error:null,
  // letting us tell a genuinely-missing user row (return null → /login) apart
  // from a query/network error (retry, then throw). Retry a few times to ride
  // out the proxy's intermittent stalls.
  let profile: any = null
  let lookupError: { message?: string } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from('users')
      .select('school_id, role, role_id, is_active, roles(is_admin, permissions)')
      .eq('id', userId)
      .maybeSingle()
    if (!error) {
      profile = data
      lookupError = null
      break
    }
    lookupError = error
    // Brief backoff before retrying (150ms, 300ms).
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
  }

  // Valid JWT but the profile lookup genuinely errored after retries. Throwing
  // (rather than returning null) keeps us OUT of the /login redirect loop: the
  // caller's `if (!ctx) redirect('/login')` never fires, so the user gets an
  // error/reload state instead of an infinite bounce. Real auth is untouched —
  // an unauthenticated request already returned null above.
  if (lookupError) {
    throw new Error(
      `getAuthContext: profile lookup failed for ${userId} after retries: ${lookupError.message ?? 'unknown error'}`
    )
  }

  // Query succeeded but there is no user row (e.g. deleted account) → treat as
  // unauthenticated.
  if (!profile) return null

  // A school-less super_admin with no active impersonation session (handled
  // above) gets schoolId: null here, deliberately — no guessed fallback.
  // Every caller already redirects a null getAuthContext() / null schoolId
  // page to /login or an empty state; see Part A of the impersonation plan.
  const schoolId = profile.school_id as string | null

  const roleRow = (profile as any).roles as { is_admin?: boolean; permissions?: Record<string, boolean> } | null
  const isOwner =
    profile.role === 'super_admin' ||
    profile.role === 'school_admin' ||
    roleRow?.is_admin === true

  // A deactivated user keeps no permissions (belt-and-suspenders alongside
  // has_permission()'s is_active check and the middleware bounce).
  const active = profile.is_active !== false

  const rawPermissions = new Set<string>()
  if (active) {
    if (isOwner) {
      for (const k of PERMISSION_KEYS) rawPermissions.add(k)
    } else if (roleRow?.permissions) {
      for (const k of PERMISSION_KEYS) {
        if (roleRow.permissions[k] === true) rawPermissions.add(k)
      }
    }
  }

  return {
    supabase,
    userId,
    schoolId,
    role: profile.role,
    roleId: (profile.role_id as string | null) ?? null,
    isOwner: isOwner && active,
    permissions: rawPermissions,
    isActive: active,
    isImpersonating: false,
    impersonationSessionId: null,
  }
}

// Per-request memoized. Multiple callers in one render (layout, page, query)
// share a single DB read.
export const getAuthContext = cache(loadAuthContext)

const DO_PERMISSION_KEYS = new Set(PERMISSIONS.filter(p => p.group === 'DO').map(p => p.key))

export function can(ctx: AuthContext | null, perm: string): boolean {
  if (!ctx) return false
  // Impersonation is read-only, full stop. loadAuthContext() already strips
  // isOwner and every DO-group permission for an impersonating context, but
  // this is the actual enforcement point every requirePermission()/actions.ts
  // call runs through — it's load-bearing (per the roadmap note), not just
  // defense-in-depth, so it re-checks explicitly rather than trusting the
  // upstream computation alone.
  if (ctx.isImpersonating && DO_PERMISSION_KEYS.has(perm) && !IMPERSONATION_WRITE_ALLOWLIST.has(perm)) {
    return false
  }
  return ctx.isOwner || ctx.permissions.has(perm)
}

// Convenience for pages/actions: load the context and assert a permission.
// Returns the context when allowed, null otherwise — the caller decides whether
// to redirect (pages) or return an error (server actions).
export async function requirePermission(perm: string): Promise<AuthContext | null> {
  const ctx = await getAuthContext()
  return can(ctx, perm) ? ctx : null
}

// The permission keys the current user holds, as a plain array — handy for
// seeding the client PermissionsProvider.
export function permissionList(ctx: AuthContext | null): string[] {
  if (!ctx) return []
  return ctx.isOwner ? [...PERMISSION_KEYS] : Array.from(ctx.permissions)
}
