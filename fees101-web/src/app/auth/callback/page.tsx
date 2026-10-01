'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Landing point for Supabase email links (staff invite / owner invite /
// password recovery). Two different link shapes land here depending on how
// the link was created:
//  - Admin-generated links (auth.admin.generateLink — staff invites, owner
//    invites) redirect back with the session as an `#access_token=...` hash
//    fragment. A hash fragment never reaches the server, so this has to be a
//    client component that reads window.location.hash, not a route handler.
//  - Self-service links (resetPasswordForEmail, initiated from this app's own
//    browser client) use PKCE and come back with a `?code=` query param.
function AuthCallback() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const supabase = createClient()
    const next = searchParams.get('next') || '/set-password'

    async function finish() {
      const code = searchParams.get('code')
      if (code) {
        await supabase.auth.exchangeCodeForSession(code)
        router.replace(next)
        return
      }

      const hash = new URLSearchParams(window.location.hash.slice(1))
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      }
      // No code, no hash tokens — an expired/already-used link (hash carries
      // #error=... instead). Forward to `next` anyway: /set-password's own
      // !hasSession branch renders the "this invite has expired" state.
      router.replace(next)
    }

    finish()
  }, [router, searchParams])

  return null
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallback />
    </Suspense>
  )
}
