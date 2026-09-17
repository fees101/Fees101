'use client'

import { useState } from 'react'
import { forgotPassword } from '../login/actions'

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await forgotPassword(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      setSent(true)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-5">
      <div className="bg-white p-10 rounded-xl border border-gray-200 w-full max-w-md">
        <h1 className="text-navy text-3xl font-bold mb-2">Fees101</h1>

        {sent ? (
          <>
            <p className="text-gray-700 text-sm mb-6">
              If that email matches an account, a password reset link is on its way. Check your inbox.
            </p>
            <a href="/login" className="text-mint font-semibold text-sm hover:underline">Back to sign in</a>
          </>
        ) : (
          <>
            <p className="text-gray-500 text-sm mb-8">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            <form action={handleSubmit} className="flex flex-col gap-5">
              <label className="flex flex-col gap-2 text-sm text-gray-700 font-medium">
                Email
                <input
                  type="email"
                  name="email"
                  required
                  autoFocus
                  placeholder="you@school.edu.ng"
                  className="px-3.5 py-3 border border-gray-300 rounded-lg text-sm outline-none focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </label>

              {error && (
                <p className="text-red-700 text-xs px-3 py-2 bg-red-50 rounded-md">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="bg-mint text-navy py-3 rounded-lg text-sm font-semibold hover:bg-mint/90 disabled:opacity-50 mt-2"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <a href="/login" className="text-gray-500 text-sm text-center hover:underline">Back to sign in</a>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
