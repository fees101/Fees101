'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { forgotPassword } from '../login/actions'

// FEES101 wordmark + red rule — the one piece of branding every logged-out
// screen in Messages.dc.html's "Staff invite" spec carries.
function Wordmark() {
  return (
    <div className="flex items-baseline gap-2 mb-6">
      <span className="text-[14px] font-extrabold" style={{ letterSpacing: '0.14em', color: 'var(--color-ink)' }}>FEES101</span>
      <span className="inline-block" style={{ width: 24, height: 2, backgroundColor: 'var(--color-signal)' }} />
    </div>
  )
}

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => { document.title = 'Forgot password · Fees101' }, [])

  // onSubmit + preventDefault, not the form `action` prop: React 19 auto-resets
  // an action form once the action resolves, which would wipe the email on a
  // failed send. Keep it so the person can correct it without retyping.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
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
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px] border-2 border-[var(--color-ink)] bg-white p-6">
        <Wordmark />
        <h1 className="text-xl font-extrabold text-[var(--color-ink)] mb-1">Reset password</h1>

        {sent ? (
          <>
            <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mt-4 mb-5">
              If that email matches an account, a password reset link is on its way. Check your inbox.
            </p>
            <a href="/login" className="m-btn m-btn-outline w-full justify-start">Back to sign in</a>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--color-neutral-700)] mb-6">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="m-label" htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  required
                  autoFocus
                  placeholder="you@yourschool.ng"
                  className="m-input"
                />
              </div>

              {error && (
                <p className="text-sm text-[var(--color-signal-text)] leading-[1.5]">{error}</p>
              )}

              <div className="mt-1">
                <button type="submit" disabled={loading} className="m-btn m-btn-primary w-full">
                  Send reset link
                </button>
                {loading && <div className="m-loading mt-2" />}
              </div>

              <a href="/login" className="text-[13px] text-center text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]">
                Back to sign in
              </a>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
