'use client'

// Admin notifications, surfaced the app-shell way: a quiet text control on the
// ink rail (and the mobile bar) with a small signal-red count, opening a flat
// paper panel. No icons, no page-top caution banner. Data and the dismiss
// action are unchanged; this only changes how the notices are presented.

import { useState } from 'react'
import { dismissAdminNotification } from '@/app/(app)/notifications-actions'

export interface AdminNotificationItem {
  id: string
  title: string
  body: string
  createdAt: string
}

interface Props {
  notifications: AdminNotificationItem[]
  // The rail footer opens upward; the mobile bar opens downward.
  dropDirection?: 'up' | 'down'
  // Compact renders just the bell (mobile bar); the default is the full
  // labelled row used in the rail footer.
  compact?: boolean
  // Which edge the panel aligns to (a right-hand bell opens leftward).
  align?: 'left' | 'right'
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

export default function NotificationsMenu({
  notifications, dropDirection = 'up', compact = false, align = 'left',
}: Props) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = notifications.filter(n => !dismissed.has(n.id))
  const count = visible.length

  async function handleDismiss(id: string) {
    setDismissed(prev => new Set(prev).add(id))
    await dismissAdminNotification(id)
  }

  return (
    <div className={compact ? 'relative' : 'relative w-full'}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={count > 0 ? `${count} notification${count === 1 ? '' : 's'}` : 'Notifications'}
        className={
          compact
            ? 'relative flex items-center gap-1.5 h-11 px-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--color-neutral-400)] hover:text-[var(--color-paper)] transition-colors'
            : 'w-full flex items-center gap-3 px-2 py-2 text-[var(--color-neutral-500)] hover:text-[var(--color-paper)] hover:bg-white/5 transition-colors'
        }
      >
        {compact ? (
          <>
            Alerts
            {count > 0 && (
              <span className="min-w-[16px] h-4 px-1 flex items-center justify-center bg-[var(--color-signal)] text-white text-[10px] font-extrabold leading-none m-num">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="flex-1 min-w-0 text-left text-sm font-semibold">Notifications</span>
            {count > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-[var(--color-signal)] text-white text-[10px] font-extrabold leading-none m-num flex-shrink-0">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            className={`absolute w-72 max-w-[calc(100vw-32px)] bg-[var(--color-paper)] border-2 border-[var(--color-ink)] z-[70] m-anim-scale ${
              align === 'right' ? 'right-0' : 'left-0'
            } ${dropDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          >
            <div className="px-4 py-3 border-b-2 border-[var(--color-ink)] flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-neutral-700)]">
                Notifications
              </p>
              {count > 0 && <span className="m-chip m-chip-neutral m-num">{count}</span>}
            </div>

            {count === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--color-neutral-700)]">You&apos;re all caught up.</p>
            ) : (
              <ul className="max-h-[60vh] overflow-y-auto">
                {visible.map(n => (
                  <li key={n.id} className="px-4 py-3 border-b border-[var(--color-neutral-200)] last:border-b-0 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{n.title}</p>
                      <p className="text-xs text-[var(--color-neutral-700)] mt-0.5">{n.body}</p>
                      <p className="text-[11px] text-[var(--color-neutral-500)] mt-1 m-num">{timeAgo(n.createdAt)}</p>
                    </div>
                    <button
                      onClick={() => handleDismiss(n.id)}
                      className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)] flex-shrink-0"
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
