import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Landing point for Supabase email links (staff invite / password recovery).
// The link hits Supabase's verify endpoint, which redirects here with a PKCE
// `code`; we exchange it for a session cookie, then forward to wherever the
// flow wants to continue (default: set a password).
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/set-password'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    // Code present but the exchange failed — an expired or already-used
    // link. Forward to `next` anyway rather than bouncing to /login:
    // /set-password's own !hasSession branch already renders the "this
    // invite/link has expired" state, and for an invite link `next` carries
    // a `uid` query param (see team/users/actions.ts's addStaff/
    // resendInvite) that lets that screen offer "notify whoever invited you."
    return NextResponse.redirect(`${origin}${next}`)
  }

  // No code at all — a bare/garbage hit, not a real auth link.
  return NextResponse.redirect(`${origin}/login?error=link_invalid`)
}
