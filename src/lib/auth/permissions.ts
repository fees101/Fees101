import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { PERMISSION_KEYS } from './permissionCatalog'

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
}

// Uncached loader. getAuthContext() wraps this in cache() for per-request reuse.
async function loadAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient()
  // Validate the JWT locally (getClaims) rather than a network round-trip to
  // the Auth server (getUser) — the middleware already gates access, and with
  // asymmetric signing keys this is signature-only. `claims.sub` is the user id.
  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub
  // No valid JWT → genuinely unauthenticated. This is the ONLY condition that
  // legitimately sends the caller down its `if (!ctx) redirect('/login')` path.
  if (!userId) return null

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

  // super_admin (Fees101 staff) with no school: fall back to the first school,
  // preserving the long-standing behavior across the app.
  let schoolId = profile.school_id as string | null
  if (!schoolId && profile.role === 'super_admin') {
    const { data: firstSchool } = await supabase.from('schools').select('id').limit(1).single()
    schoolId = firstSchool?.id ?? null
  }

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
  }
}

// Per-request memoized. Multiple callers in one render (layout, page, query)
// share a single DB read.
export const getAuthContext = cache(loadAuthContext)

export function can(ctx: AuthContext | null, perm: string): boolean {
  if (!ctx) return false
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
