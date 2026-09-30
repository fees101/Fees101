'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { notifyInviterOfExpiredLink } from './actions'

// FEES101 wordmark + red rule — the one piece of branding every logged-out
// screen in Messages.dc.html's "Staff invite" spec carries, live text and a
// 2px rule rather than an image (nothing to fail to load).
function Wordmark() {
  return (
    <div className="flex items-baseline gap-2 mb-6">
      <span className="text-[14px] font-extrabold" style={{ letterSpacing: '0.14em', color: 'var(--color-ink)' }}>FEES101</span>
      <span className="inline-block" style={{ width: 24, height: 2, backgroundColor: 'var(--color-signal)' }} />
    </div>
  )
}

// Where a newly-invited staff member (or anyone using a recovery link) sets
// their password. By the time they reach here, /auth/callback has already
// exchanged the link's code for a session, so we just need a valid session and
// a call to updateUser({ password }).
export default function SetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()

  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [schoolName, setSchoolName] = useState<string | null>(null)
  // Only present for a genuine invite (from inviteUserByEmail's user_metadata)
  // — a self-service password reset has neither, so the info grid below
  // quietly renders just the SCHOOL row it does have.
  const [inviterName, setInviterName] = useState<string | null>(null)
  const [roleName, setRoleName] = useState<string | null>(null)
  const [fullName, setFullName] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { document.title = 'Set password · Fees101' }, [])

  // The invitee's email, carried through the invite link's `next` query
  // string (see team/users/actions.ts's addStaff/resendInvite) so an
  // expired link can still say who to notify — the whole reason someone
  // lands on this screen with no session at all.
  const [inviteeEmail, setInviteeEmail] = useState<string | null>(null)
  const [notifyState, setNotifyState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [notifyMessage, setNotifyMessage] = useState<string | null>(null)

  useEffect(() => {
    setInviteeEmail(new URLSearchParams(window.location.search).get('email'))

    supabase.auth.getUser().then(async ({ data }) => {
      setHasSession(!!data.user)
      // The school/inviter/role set at invite time (see addStaff's
      // inviteUserByEmail `data` payload) is readable straight off
      // user_metadata — no extra query needed for the common (invite) case. A
      // self-service password reset has no such metadata, so fall back to a
      // small RLS-scoped query through the session that was just established.
      const meta = data.user?.user_metadata as Record<string, string> | undefined
      if (meta?.school_name) {
        setSchoolName(meta.school_name)
        setInviterName(meta.inviter_name || null)
        setRoleName(meta.role_name || null)
        setFullName(meta.name || null)
      } else if (data.user) {
        // Qualified by FK name: schools has two paths from users
        // (users.school_id -> schools.id, and schools.keys_rotated_by ->
        // users.id), so an unqualified "schools(...)" embed is ambiguous to
        // PostgREST — see (app)/layout.tsx's loadDisplayProfile for the same
        // fix.
        const { data: profile } = await supabase
          .from('users')
          .select('name, schools!users_school_id_fkey(name)')
          .eq('id', data.user.id)
          .maybeSingle()
        setSchoolName((profile?.schools as any)?.name || null)
        setFullName(profile?.name || null)
      }
      setChecking(false)
    })
  }, [supabase])

  async function handleNotifyInviter() {
    if (!inviteeEmail) return
    setNotifyState('sending')
    const result = await notifyInviterOfExpiredLink(inviteeEmail)
    if ('error' in result) {
      setNotifyState('error')
      setNotifyMessage(result.error)
    } else {
      setNotifyState('sent')
      setNotifyMessage(`${result.inviterName} has been notified.`)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 10) return setError('Password must be at least 10 characters.')

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setSaving(false)
      return setError(error.message)
    }
    router.push('/today')
  }

  const firstName = fullName?.trim().split(/\s+/)[0] || null
  // Purely a visual nudge (length-based, 4 segments) — the actual gate stays
  // the 10-character minimum enforced above and by `minLength` on the field.
  const strengthFilled = Math.max(0, Math.min(4, Math.floor(password.length / 4)))

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px] border-2 border-[var(--color-ink)] bg-white p-6">
        <Wordmark />
        {checking ? (
          <>
            <h1 className="text-xl font-extrabold text-[var(--color-ink)] mb-4">Checking your link</h1>
            <div className="m-loading" />
          </>
        ) : !hasSession ? (
          <>
            <p className="text-[11px] font-semibold tracking-[0.12em] text-[var(--color-ochre-text)] mb-2">EXPIRED LINK</p>
            <h1 className="text-xl font-extrabold text-[var(--color-ink)] mb-2 leading-[1.25]">This invite has expired</h1>
            <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
              This link is either used up or older than seven days. Sign in if you already set a password, or ask
              whoever invited you to send a new one.
            </p>
            <a href="/login" className="m-btn m-btn-primary w-full justify-start mb-3">Go to sign in</a>
            {inviteeEmail && (
              <>
                <button
                  type="button"
                  onClick={handleNotifyInviter}
                  disabled={notifyState === 'sending' || notifyState === 'sent'}
                  className="m-btn m-btn-outline w-full justify-start mb-3"
                >
                  {notifyState === 'sent' ? 'Notified' : 'Notify whoever invited you'}
                </button>
                {notifyMessage && (
                  <p
                    className="text-[13px] leading-[1.5] mb-3"
                    style={{ color: notifyState === 'error' ? 'var(--color-signal-text)' : 'var(--color-neutral-700)' }}
                  >
                    {notifyMessage}
                  </p>
                )}
              </>
            )}
            <p className="text-[13px] leading-[1.5] text-[var(--color-neutral-700)] pt-3 border-t-2 border-[var(--color-neutral-300)]">
              Also covers a reset link that has already been used.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-extrabold text-[var(--color-ink)] mb-4 leading-[1.1]" style={{ letterSpacing: '-0.02em' }}>
              {firstName ? `Set a password, ${firstName}.` : 'Set a password.'}
            </h1>

            {(schoolName || inviterName || roleName) && (
              <div
                className="mb-5 py-3"
                style={{ borderTop: '2px solid var(--color-ink)', borderBottom: '1px solid var(--color-neutral-300)' }}
              >
                <div className="grid gap-y-2" style={{ gridTemplateColumns: '92px minmax(0,1fr)', fontSize: 13 }}>
                  {schoolName && (
                    <>
                      <span className="text-[11px] font-semibold text-[var(--color-neutral-700)]" style={{ letterSpacing: '0.06em' }}>SCHOOL</span>
                      <span className="font-semibold text-[var(--color-ink)]">{schoolName}</span>
                    </>
                  )}
                  {inviterName && (
                    <>
                      <span className="text-[11px] font-semibold text-[var(--color-neutral-700)]" style={{ letterSpacing: '0.06em' }}>INVITED BY</span>
                      <span className="text-[var(--color-ink)]">{inviterName}</span>
                    </>
                  )}
                  {roleName && (
                    <>
                      <span className="text-[11px] font-semibold text-[var(--color-neutral-700)]" style={{ letterSpacing: '0.06em' }}>ROLE</span>
                      <span className="text-[var(--color-ink)]">{roleName}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="m-label" htmlFor="password">New password</label>
                <div className="flex items-center gap-2">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={10}
                    autoFocus
                    className="m-input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-neutral-700)] whitespace-nowrap"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="flex gap-1 mt-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      style={{ height: 4, flex: 1, backgroundColor: i < strengthFilled ? 'var(--color-ink)' : 'var(--color-neutral-300)' }}
                    />
                  ))}
                </div>
                <p className="text-[12px] text-[var(--color-neutral-700)] mt-1.5">At least ten characters.</p>
              </div>

              {error && (
                <p className="text-sm text-[var(--color-signal-text)] leading-[1.5]">{error}</p>
              )}

              <div className="mt-1">
                <button type="submit" disabled={saving} className="m-btn m-btn-primary w-full">
                  {saving ? 'Setting password...' : 'Set password and sign in'}
                </button>
                {saving && <div className="m-loading mt-2" />}
              </div>
            </form>

            <p className="text-[13px] leading-[1.5] text-[var(--color-neutral-700)] mt-5 pt-3 border-t-2 border-[var(--color-neutral-300)]">
              The link works once and expires after seven days.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
