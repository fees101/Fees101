'use client'

import { useEffect, useState } from 'react'
import { endImpersonation } from '@/app/(app)/_impersonation/actions'

interface ImpersonationBannerProps {
  schoolName: string
  expiresAt: string | null
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

// Persistent, impossible-to-miss notice that the current session is a
// platform-admin "view as" session, not the platform admin's own account and
// not the viewed school's own staff. Deliberately plain (matches the App
// Shell's ink-on-paper look, no alarm colours) — it's a standing fact about
// this session, not a warning about something going wrong.
export default function ImpersonationBanner({ schoolName, expiresAt }: ImpersonationBannerProps) {
  // Computed in an effect, not inline in useState() — reading the clock is an
  // impure call and isn't allowed during render.
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    if (!expiresAt) return
    const target = new Date(expiresAt).getTime()
    const tick = () => setRemainingMs(target - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  async function handleEnd() {
    setEnding(true)
    await endImpersonation()
    // endImpersonation() redirects server-side; this just guards against the
    // button sitting in a clicked-but-stuck state if that ever doesn't fire.
    setEnding(false)
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 text-[var(--color-paper)]">
      <p className="text-xs font-semibold uppercase tracking-[0.08em]">
        Viewing {schoolName} — read-only
        {remainingMs !== null && (
          <span className="m-num font-normal normal-case tracking-normal text-[var(--color-neutral-400)]">
            {' '}&middot; {formatCountdown(remainingMs)} left
          </span>
        )}
      </p>
      <button
        onClick={handleEnd}
        disabled={ending}
        className="shrink-0 border border-[var(--color-paper)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-paper)] transition-colors hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)] disabled:opacity-60"
      >
        {ending ? 'Ending…' : 'End session'}
      </button>
    </div>
  )
}
