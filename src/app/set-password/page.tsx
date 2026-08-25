'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Where a newly-invited staff member (or anyone using a recovery link) sets
// their password. By the time they reach here, /auth/callback has already
// exchanged the link's code for a session, so we just need a valid session and
// a call to updateUser({ password }).
export default function SetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()

  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user)
      setChecking(false)
    })
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setSaving(false)
      return setError(error.message)
    }
    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-5">
      <div className="bg-white p-10 rounded-xl border border-gray-200 w-full max-w-md">
        <h1 className="text-navy text-3xl font-bold mb-2">Fees101</h1>
        <p className="text-gray-500 text-sm mb-8">Set a password to activate your account</p>

        {checking ? (
          <p className="text-sm text-gray-500">Checking your invite link…</p>
        ) : !hasSession ? (
          <div className="text-sm text-gray-600">
            <p className="mb-3">This link is invalid or has expired.</p>
            <a href="/login" className="text-mint font-semibold hover:underline">Go to sign in</a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <label className="flex flex-col gap-2 text-sm text-gray-700 font-medium">
              New password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 font-normal"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-gray-700 font-medium">
              Confirm password
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 font-normal"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="bg-navy text-white font-semibold rounded-lg px-4 py-2.5 text-sm hover:bg-navy/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Set password & continue'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
