import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // Return a normal response — NOT redirect(). redirect() throws NEXT_REDIRECT,
  // which aborts the response before signOut()'s cleared auth cookies are
  // flushed as Set-Cookie headers, leaving the session cookie alive (the user
  // stays signed in / can't switch accounts). The client (UserMenu.handleLogout)
  // navigates to /login itself after this fetch resolves, so no redirect is needed.
  return NextResponse.json({ ok: true })
}

// GET variant used by the (app) layout to bounce a deactivated / scheduled-for-
// deletion user: it clears their session (a route handler CAN set cookies —
// a Server Component can't) and forwards the reason to the login screen. Going
// through here instead of redirecting straight to /login avoids a redirect loop
// (middleware would otherwise send a still-"authenticated" session back to
// /dashboard, which the layout bounces again).
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const reason = new URL(request.url).searchParams.get('error')
  const dest = reason ? `/login?error=${encodeURIComponent(reason)}` : '/login'
  return NextResponse.redirect(new URL(dest, request.url))
}
