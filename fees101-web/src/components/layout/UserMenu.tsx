'use client'

import { useState } from 'react'
import { ACTIVE_JOBS_STORAGE_KEY } from '@/lib/jobs/ActiveJobsProvider'

interface UserMenuProps {
  userName: string
  userEmail: string
  userRole: string
  schoolName: string
  schoolLogoUrl?: string | null
  dropDirection?: 'down' | 'up'
  collapsed?: boolean
}

function getInitials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export default function UserMenu({
  userName, userEmail, userRole, schoolName, schoolLogoUrl,
  dropDirection = 'down', collapsed = false,
}: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const schoolInitials = getInitials(schoolName)
  const roleLabel = userRole.replace('_', ' ')

  async function handleLogout() {
    // The route always actually signs out regardless of what comes back here
    // (see src/app/logout/route.ts) — this response is only read to decide
    // whether landing on /login needs to say "N invoices were still
    // sending" instead of a plain sign-in screen. If it fails to parse for
    // any reason, fall back to the zero-jobs (plain) redirect rather than
    // blocking sign-out on it.
    let invoicesInFlight = 0
    try {
      const res = await fetch('/logout', { method: 'POST' })
      const data = await res.json()
      if (typeof data?.invoicesInFlight === 'number') invoicesInFlight = data.invoicesInFlight
    } catch {
      // Sign-out already happened server-side; just can't report the count.
    }
    try {
      localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY)
    } catch {
      // Private-browsing/storage-blocked contexts — nothing to clean up.
    }
    window.location.href = invoicesInFlight > 0
      ? `/login?notice=signed_out&jobs=${invoicesInFlight}`
      : '/login'
  }

  return (
    <div className="relative w-full">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 px-1 py-1.5 transition-colors hover:bg-white/5 ${collapsed ? 'justify-center' : ''}`}
      >
        {/* 32px school mark. A real logo shows in full (contained on white, never
            cropped); with no logo uploaded yet it falls back to initials on the
            brand red. Zero radius. */}
        <span className="w-8 h-8 flex-shrink-0 overflow-hidden">
          {schoolLogoUrl ? (
            <span className="w-full h-full flex items-center justify-center bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={schoolLogoUrl} alt={schoolName} className="max-w-full max-h-full object-contain" />
            </span>
          ) : (
            <span className="w-full h-full flex items-center justify-center bg-[var(--color-signal)] text-white text-xs font-extrabold tracking-tight">
              {schoolInitials}
            </span>
          )}
        </span>
        {!collapsed && (
          <span className="flex-1 min-w-0 text-left">
            <span className="block text-[13px] font-semibold text-[var(--color-paper)] leading-tight truncate">
              {userName}
            </span>
            <span className="block text-[11px] text-[var(--color-neutral-500)] capitalize truncate">
              {roleLabel} · {schoolName}
            </span>
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop to close menu */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          {/* Dropdown — flat surface, 2px ink border, zero radius. */}
          <div className={`absolute w-64 bg-[var(--color-paper)] border-2 border-[var(--color-ink)] z-20 ${
            dropDirection === 'up' ? 'left-0 bottom-full mb-2' : 'right-0 mt-2'
          }`}>
            <div className="p-4 border-b-2 border-[var(--color-ink)]">
              <p className="text-[var(--color-ink)] font-semibold text-sm">{userName}</p>
              <p className="text-[var(--color-neutral-700)] text-xs mt-1 break-words">{userEmail}</p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[var(--color-neutral-700)]">{schoolName}</span>
                <span className="m-chip m-chip-neutral capitalize">{roleLabel}</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-3 text-sm font-medium text-[var(--color-signal-text)] hover:bg-[var(--color-signal-100)] transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
