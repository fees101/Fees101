import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Confirms a school's contact email address (schools.email — not a login
// credential, just Fees101's own way to reach the school) via the link sent
// by school/actions.ts's sendSchoolEmailVerification(). No session is
// required to open this link, so it runs on the service-role client and
// authorizes purely via the single-use token, the same trust model as
// Supabase's own recovery links.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const origin = request.nextUrl.origin
  if (!token) {
    return NextResponse.redirect(`${origin}/school?emailVerify=missing`)
  }

  const supabase = createServiceRoleClient()
  const { data: school } = await supabase
    .from('schools')
    .select('id')
    .eq('email_verify_token', token)
    .maybeSingle()

  if (!school) {
    return NextResponse.redirect(`${origin}/school?emailVerify=invalid`)
  }

  await supabase
    .from('schools')
    .update({ email_verified_at: new Date().toISOString(), email_verify_token: null })
    .eq('id', school.id)

  return NextResponse.redirect(`${origin}/school?emailVerify=ok`)
}
