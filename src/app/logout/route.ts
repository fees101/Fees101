import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NextRequest, NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
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
