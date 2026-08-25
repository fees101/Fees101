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
  }

  // No code or exchange failed — send them to login with a hint.
  return NextResponse.redirect(`${origin}/login?error=link_invalid`)
}
