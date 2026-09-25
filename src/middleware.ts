import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { countInFlightInvoiceSends } from '@/lib/jobs/backgroundJobs'

// --- 8-hour idle-session timeout -------------------------------------------
// No idle-timeout existed anywhere before this: a signed-in session lived as
// long as the underlying Supabase refresh token did (weeks), so a shared or
// unattended browser stayed signed in indefinitely. Tracked in a dedicated
// cookie rather than a DB column so this never adds a write on every single
// request — see IDLE_COOKIE_REFRESH_MS below for the actual write cadence.
//
// Cookie value is `${session_id}:${lastSeenMs}`. session_id is a required
// Supabase JWT claim (auth-js RequiredClaims) identifying ONE sign-in — a
// fresh login always gets a new session_id. That's what makes this safe on a
// shared computer: a stale cookie left over from a previous person's session
// doesn't get mistaken for "this session has been idle 8 hours" and
// immediately log the next person out — it's simply a session_id this
// request has never seen, so tracking just (re)starts from now.
const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000
const IDLE_COOKIE_REFRESH_MS = 5 * 60 * 1000
const IDLE_COOKIE_NAME = 'f101_last_seen'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Verify the session by validating the JWT LOCALLY (getClaims) instead of a
  // network round-trip to the Auth server on every request (getUser). With
  // asymmetric JWT signing keys enabled on the project this is signature-only,
  // no network; it still refreshes an expired token via the cookie adapter.
  // This is the scalable pattern — a per-request auth-server call doesn't hold
  // up under load. `claims.sub` is the user id when signed in; null otherwise.
  const { data: claimsData } = await supabase.auth.getClaims()
  const user = claimsData?.claims ?? null

  // Force a sign-out once a signed-in session has gone untouched for 8 hours.
  // Runs before any other routing decision below so an idle session never
  // reaches a protected page on its way out. See the IDLE_* constants above.
  if (user) {
    const sessionId = user.session_id
    const idleCookie = request.cookies.get(IDLE_COOKIE_NAME)?.value
    const [cookieSessionId, cookieTsRaw] = idleCookie ? idleCookie.split(':') : []
    const lastSeen = cookieSessionId === sessionId ? Number(cookieTsRaw) : NaN
    const now = Date.now()

    if (Number.isFinite(lastSeen) && now - lastSeen > IDLE_TIMEOUT_MS) {
      // Snapshot in-flight sends before signing out — same purely-read check
      // the manual sign-out route uses (src/app/logout/route.ts) — so the
      // screen this lands on can say how many invoices are still going out.
      // The job itself is untouched either way; see countInFlightInvoiceSends.
      const invoicesInFlight = await countInFlightInvoiceSends(supabase)
      await supabase.auth.signOut()

      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      if (invoicesInFlight > 0) {
        url.searchParams.set('notice', 'signed_out')
        url.searchParams.set('jobs', String(invoicesInFlight))
      }

      // signOut() above re-pointed `supabaseResponse` (via the cookie
      // adapter's setAll callback) at a fresh NextResponse carrying the
      // cleared auth cookies — clear the idle cookie itself on that same
      // response, then copy every cookie it now holds onto the redirect
      // response, which otherwise starts with none of them.
      supabaseResponse.cookies.set(IDLE_COOKIE_NAME, '', { maxAge: 0, path: '/' })
      const redirectResponse = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }

    // Throttled refresh: only rewrite the cookie once several minutes have
    // passed since it was last set, not on every request — the point of
    // this cadence is avoiding a write (well, a Set-Cookie header) on every
    // single navigation while someone is actively using the app.
    if (!Number.isFinite(lastSeen) || now - lastSeen > IDLE_COOKIE_REFRESH_MS) {
      supabaseResponse.cookies.set(IDLE_COOKIE_NAME, `${sessionId}:${now}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        // Comfortably longer than IDLE_TIMEOUT_MS — the 8-hour rule above is
        // enforced by comparing the embedded timestamp, not by relying on
        // the cookie's own expiry, so this only needs to outlive one
        // refresh interval's worth of slack.
        maxAge: 60 * 60 * 24,
      })
    }
  }

  // Public signup is disabled — schools are onboarded by Fees101, and staff are
  // added from within a school (Settings → Users). Send any /signup hit to login.
  if (request.nextUrl.pathname.startsWith('/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // NOTE: the per-request is_active lookup that used to live here was removed —
  // it duplicated the is_active column getAuthContext() already selects, and
  // has_permission() ANDs is_active server-side, so a deactivated user gets
  // zero permissions and is redirected out by the page/action gate on their
  // next move regardless. Deactivation stays enforced; it's just no longer an
  // extra DB round-trip on every single navigation.

  // Protected routes: anything under /today, /students, /fees, /money, /school, /team
  const protectedPaths = ['/today', '/students', '/fees', '/money', '/school', '/team']
  const isProtectedRoute = protectedPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )

  // Auth pages: /login, /signup, /forgot-password
  const authPaths = ['/login', '/signup', '/forgot-password']
  const isAuthPath = authPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )

  // Not logged in + trying to access protected route → redirect to login
  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Logged in + visiting login/signup → redirect to dashboard
  if (user && isAuthPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/today'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // All of /api excluded: every route under it enforces its own auth
    // (getSchoolContext()/auth.getUser() for the PDF routes, signature +
    // service-role for webhooks) — none of them were ever actually gated by
    // the redirect logic above anyway, since none match protectedPaths.
    // Rule going forward: middleware protects pages, /api protects itself.
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}