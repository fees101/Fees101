import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  // Protected routes: anything under /dashboard, /students, /fees, /invoices, /settings
  const protectedPaths = ['/dashboard', '/students', '/fees', '/invoices', '/settings']
  const isProtectedRoute = protectedPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )

  // Auth pages: /login, /signup
  const authPaths = ['/login', '/signup']
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
    url.pathname = '/dashboard'
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