import { createClient } from '@/lib/supabase/server'
import { countInFlightInvoiceSends } from '@/lib/jobs/backgroundJobs'
import { NextRequest, NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  // Snapshot BEFORE signing out, while the session (and its RLS scoping to
  // this school) still exists. Purely informational — see
  // countInFlightInvoiceSends — so it never delays or interrupts sign-out.
  const invoicesInFlight = await countInFlightInvoiceSends(supabase)
  await supabase.auth.signOut()
  // Return a normal response — NOT redirect(). redirect() throws NEXT_REDIRECT,
  // which aborts the response before signOut()'s cleared auth cookies are
  // flushed as Set-Cookie headers, leaving the session cookie alive (the user
  // stays signed in / can't switch accounts). The client (UserMenu.handleLogout)
  // navigates to /login itself after this fetch resolves, so no redirect is needed.
  return NextResponse.json({ ok: true, invoicesInFlight })
}

// GET variant used by the (app) layout to bounce a deactivated / scheduled-for-
// deletion user: it clears their session (a route handler CAN set cookies —
// a Server Component can't) and forwards the reason to the login screen. Going
// through here instead of redirecting straight to /login avoids a redirect loop
// (middleware would otherwise send a still-"authenticated" session back to
// /today, which the layout bounces again).
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const url = new URL(request.url)
  const reason = url.searchParams.get('error')
  if (!reason) return NextResponse.redirect(new URL('/login', request.url))

  // Forward through whatever identifying context the (app) layout attached
  // (uid for account_deactivated, until for scheduled_deletion) so the login
  // screen's bounce card can look up and show who/when instead of a generic
  // message.
  const params = new URLSearchParams({ error: reason })
  for (const key of ['uid', 'until']) {
    const value = url.searchParams.get(key)
    if (value) params.set(key, value)
  }
  return NextResponse.redirect(new URL(`/login?${params.toString()}`, request.url))
}
