'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { login, getDeactivationDetails } from './actions'
import { cancelScheduledDeletion } from '@/app/(app)/team/data-privacy/actions'
import { formatDeletionDate } from '@/lib/dataPrivacy/config'
import { ACTIVE_JOBS_STORAGE_KEY } from '@/lib/jobs/ActiveJobsProvider'

// Reason codes a redirect can land here with — see (app)/layout.tsx (instant
// deactivation kick-out) and login/actions.ts (self-closed school, caught at
// sign-in). Each renders as its own state card instead of a generic banner;
// see "Auth & Edges.dc.html" (authStates) for the copy this is drawn from.
type BounceReason = 'account_deactivated' | 'scheduled_deletion' | null

// Extra context a bounce can carry, gathered either from the redirect's own
// query params (the passive path — a stale session hit a page and got
// bounced out, see (app)/layout.tsx + logout/route.ts) or from a fresh
// sign-in attempt during the grace period (login/actions.ts's login()).
interface BounceDetail {
  scheduledFor?: string
  isOwner?: boolean
  deactivatedByName?: string
  deactivatedAt?: string
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [bounce, setBounce] = useState<BounceReason>(null)
  const [bounceDetail, setBounceDetail] = useState<BounceDetail>({})
  const [loading, setLoading] = useState(false)
  // Set when a sign-out (manual, from UserMenu, or the 8-hour idle timeout
  // in src/middleware.ts) landed here because a bulk_send job was still
  // running at that moment — see SignedOutNotice below. Null means no such
  // notice; a plain sign-out with nothing in flight never sets this.
  const [signedOutJobs, setSignedOutJobs] = useState<number | null>(null)

  useEffect(() => { document.title = 'Log in · Fees101' }, [])

  // Surface the reason when a page redirected here with ?error= (e.g. an
  // account that was deactivated mid-session and bounced out of the app).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const reason = params.get('error')
    if (reason === 'account_deactivated') {
      setBounce(reason)
      // uid identifies whose account this was (see (app)/layout.tsx) — look
      // up who deactivated it and when so the card can name them instead of
      // a generic message. Best-effort: getDeactivationDetails already
      // returns null on any miss, which just keeps the generic copy.
      const uid = params.get('uid')
      if (uid) {
        getDeactivationDetails(uid).then((details) => {
          if (details) {
            setBounceDetail({ deactivatedByName: details.actorName, deactivatedAt: details.date })
          }
        })
      }
    } else if (reason === 'scheduled_deletion') {
      setBounce(reason)
      // This passive path (a stale session, not a fresh sign-in) can never
      // prove the visitor is the owner, so it never gets the cancel button —
      // only a credential-based attempt below can (see handleSubmit).
      setBounceDetail({ scheduledFor: params.get('until') || undefined, isOwner: false })
    }
  }, [])

  // Surface "N invoices were still sending" when /logout or the idle timeout
  // redirected here with ?notice=signed_out&jobs=N (N > 0 only — the zero-jobs
  // case is a plain sign-out and never sets these params in the first place).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('notice') !== 'signed_out') return
    const jobs = Number(params.get('jobs'))
    if (Number.isFinite(jobs) && jobs > 0) setSignedOutJobs(jobs)
    try {
      // Clear any tracked-job chip left over from the ended session — same
      // "next person on this shared computer" reasoning as the manual
      // sign-out path (UserMenu.handleLogout), covering the idle-timeout
      // path, which redirects here with no client JS able to run first.
      localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY)
    } catch {
      // Private-browsing/storage-blocked contexts — nothing to clean up.
    }
  }, [])

  // onSubmit + preventDefault, not the form `action` prop: React 19 auto-resets
  // an action form once the action resolves, so a wrong password would also wipe
  // the email the person just typed. Keep both filled so they only fix the typo.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setLoading(true)
    setError(null)
    setBounce(null)
    const result = await login(formData)
    if (result && 'scheduledDeletion' in result && result.scheduledDeletion) {
      // Credentials were right, but the school is closing. Unlike the
      // passive bounce above, this came from a real sign-in attempt, so
      // login() already knows whether this is the owner — the one person
      // who gets a working "cancel" button on this same card.
      setBounce('scheduled_deletion')
      setBounceDetail({
        scheduledFor: result.scheduledDeletion.scheduledFor,
        isOwner: result.scheduledDeletion.isOwner,
      })
      setLoading(false)
      return
    }
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[880px]">
        {signedOutJobs !== null ? (
          <SignedOutNotice jobs={signedOutJobs} onDismiss={() => setSignedOutJobs(null)} />
        ) : bounce ? (
          <BounceNotice
            reason={bounce}
            detail={bounceDetail}
            onDismiss={() => { setBounce(null); setBounceDetail({}) }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 border-2 border-[var(--color-ink)]">
            {/* Ink panel — the mark and the pitch. No live figures here: this
                screen is reachable signed out, before any school data loads. */}
            <div className="bg-[var(--color-ink)] px-7 py-8 md:px-8 md:py-9 flex flex-col justify-between gap-8 order-2 md:order-1">
              <div className="border-l-[5px] border-[var(--color-signal)] pl-3">
                <span className="block text-[11px] font-extrabold uppercase tracking-[0.24em] text-[var(--color-paper)] leading-none">Fees</span>
                <span className="block text-[34px] font-extrabold tracking-[-0.045em] text-white leading-none mt-0.5 m-num">101</span>
              </div>
              <div>
                <p className="text-[15px] leading-[1.5] text-white mb-2.5 max-w-[30ch] font-semibold">
                  School fees, collected and accounted for.
                </p>
                <p className="text-sm leading-[1.5] text-[var(--color-neutral-500)] max-w-[38ch]">
                  Sign in to pick up where the school left off.
                </p>
              </div>
            </div>

            {/* Paper panel — the form, flush left, ink button. */}
            <div className="bg-white px-7 py-8 md:px-8 md:py-9 order-1 md:order-2">
              <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-ink)] mb-1">Sign in</h1>
              <p className="text-sm text-[var(--color-neutral-700)] mb-6">Use the address your school invited.</p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="m-label" htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    name="email"
                    required
                    placeholder="you@yourschool.ng"
                    className="m-input"
                  />
                </div>

                <div>
                  <label className="m-label" htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    name="password"
                    required
                    placeholder="Your password"
                    className="m-input"
                  />
                </div>

                {error && (
                  <p className="text-sm text-[var(--color-signal-text)] leading-[1.5]">{error}</p>
                )}

                <div className="mt-1">
                  <button type="submit" disabled={loading} className="m-btn m-btn-primary w-full">
                    Sign in
                  </button>
                  {loading && <div className="m-loading mt-2" />}
                </div>

                <div className="flex flex-wrap gap-3 justify-between pt-3.5 border-t-2 border-[var(--color-neutral-300)]">
                  <a href="/forgot-password" className="text-[13px]">Forgotten password</a>
                  <span className="text-[13px] text-[var(--color-neutral-700)]">No account? Your school creates it.</span>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

// One of the two "not handled today" auth states the login screen now bounces
// into as a real card instead of a pink strip: account access removed, or the
// school itself scheduled for deletion. The reason code and its underlying
// checks both exist server-side (in (app)/layout.tsx and login/actions.ts) —
// this renders the state-card treatment the design calls for, now filled in
// with who/when for a revoked account, and a working "cancel" for the owner
// during a school's closing grace period.
function BounceNotice({
  reason,
  detail,
  onDismiss,
}: {
  reason: 'account_deactivated' | 'scheduled_deletion'
  detail: BounceDetail
  onDismiss: () => void
}) {
  const isClosing = reason === 'scheduled_deletion'
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  async function handleCancel() {
    setCancelling(true)
    setCancelError(null)
    const result = await cancelScheduledDeletion()
    if (result?.error) {
      setCancelling(false)
      setCancelError(result.error)
      return
    }
    // Full reload rather than client navigation: the school's staff logins
    // were just reactivated, and a fresh request lets middleware/the (app)
    // layout re-evaluate is_active from scratch instead of trusting stale
    // client state.
    window.location.href = '/today'
  }

  const revokedBody = detail.deactivatedByName
    ? `Your access to this school was removed by ${detail.deactivatedByName} on ${formatDeletionDate(detail.deactivatedAt!)}. Contact your school administrator to have it restored.`
    : 'The credentials are right, but access to this account has been withdrawn. Contact your school administrator to have it restored.'

  const closingBody = detail.scheduledFor
    ? `The account owner started closing this school. It's scheduled for deletion on ${formatDeletionDate(detail.scheduledFor)}.`
    : 'The account owner started closing this school. Contact them directly, or reach us to cancel it before the deletion date.'

  return (
    <div className="max-w-[420px] mx-auto border-2 border-[var(--color-ink)] bg-white p-6">
      <p
        className="text-[11px] font-semibold tracking-[0.12em] mb-2"
        style={{ color: isClosing ? 'var(--color-signal-text)' : 'var(--color-ochre-text)' }}
      >
        {isClosing ? 'SCHOOL CLOSING' : 'ACCESS REVOKED'}
      </p>
      <h1
        className="text-xl font-extrabold mb-2 leading-[1.25]"
        style={{ color: isClosing ? 'var(--color-signal-text)' : 'var(--color-ink)' }}
      >
        {isClosing ? 'This school is scheduled for deletion' : 'Your access to this school was removed'}
      </h1>
      <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
        {isClosing ? closingBody : revokedBody}
      </p>

      {isClosing && detail.isOwner ? (
        <>
          {cancelError && (
            <p className="text-sm text-[var(--color-signal-text)] leading-[1.5] mb-3">{cancelError}</p>
          )}
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="m-btn m-btn-primary w-full justify-start mb-3"
          >
            Cancel the deletion
          </button>
          {cancelling && <div className="m-loading mb-3" />}
        </>
      ) : (
        <a href="mailto:support@fees101.com" className="m-btn m-btn-outline w-full justify-start mb-3">
          {isClosing ? 'Contact support to cancel' : 'Contact your school office'}
        </a>
      )}
      <button type="button" onClick={onDismiss} className="m-btn m-btn-ghost w-full justify-start">
        Try a different account
      </button>
    </div>
  )
}

// Lands here after a sign-out — manual (UserMenu → src/app/logout/route.ts)
// or the 8-hour idle timeout (src/middleware.ts) — that found the school's
// bulk_send job still running. Presentation only: sign-out never touches the
// job itself, which keeps advancing via the worker route's service-role
// client while a tab is open and the GitHub Actions sweep once it isn't (see
// countInFlightInvoiceSends in src/lib/jobs/backgroundJobs.ts) — this just
// says so instead of leaving it unclear whether a send to parents was just
// cancelled. Copy adapted from "Auth & Edges.dc.html" (authStates, kind:
// SIGNED OUT); zero jobs in flight never reaches this component at all — see
// LoginPage's ?notice=signed_out handling above.
function SignedOutNotice({ jobs, onDismiss }: { jobs: number; onDismiss: () => void }) {
  return (
    <div className="max-w-[420px] mx-auto border-2 border-[var(--color-ink)] bg-white p-6">
      <p className="text-[11px] font-semibold tracking-[0.12em] mb-2" style={{ color: 'var(--color-ochre-text)' }}>
        SIGNED OUT
      </p>
      <h1 className="text-xl font-extrabold mb-2 leading-[1.25] text-[var(--color-ink)]">
        Signed out — {jobs} {jobs === 1 ? 'invoice was' : 'invoices were'} still sending
      </h1>
      <p className="text-sm leading-[1.55] text-[var(--color-neutral-800)] mb-5">
        Sign-out confirms what was running rather than leaving it unclear. The send keeps going
        server-side, so signing out never cancels invoices already on their way to parents.
      </p>
      <button type="button" onClick={onDismiss} className="m-btn m-btn-primary w-full justify-start">
        Sign back in
      </button>
    </div>
  )
}
