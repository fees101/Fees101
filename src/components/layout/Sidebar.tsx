'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import UserMenu from './UserMenu'
import NotificationsMenu, { type AdminNotificationItem } from './NotificationsMenu'
import { usePermissions } from '@/lib/auth/PermissionsProvider'
import {
  workspaces,
  workspaceLanding,
  activeWorkspaceKey,
  type Workspace,
  type WorkspaceGroup,
} from '@/lib/nav/navConfig'

interface SidebarProps {
  userName: string
  userEmail: string
  userRole: string
  schoolName: string
  schoolLogoUrl?: string | null
  // Kept for call-site compatibility with (app)/layout.tsx. The current term
  // now surfaces in the page header and the Fees workspace, not the rail.
  currentTermName?: string | null
  currentTermId?: string | null
  notifications?: AdminNotificationItem[]
  // Per-workspace counts shown in the nav's right column (keyed by workspace
  // key: students, money, discounts). A workspace with no entry shows nothing.
  navCounts?: Record<string, number>
  // Today's activity total for the RECORD footer ("N today").
  streamCount?: number
}

const GROUPS: WorkspaceGroup[] = ['Operate', 'Configure']

export default function Sidebar({
  userName, userEmail, userRole, schoolName, schoolLogoUrl, notifications = [],
  navCounts = {}, streamCount = 0,
}: SidebarProps) {
  const pathname = usePathname()
  const { permissions, isOwner } = usePermissions()
  const activeKey = activeWorkspaceKey(pathname)
  const [mobileOpen, setMobileOpen] = useState(false)

  // A tap that navigates should also dismiss the mobile drawer.
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Each workspace resolves to the first mode this role can actually reach; a
  // workspace with no reachable mode drops out of the rail entirely.
  const visible = workspaces
    .map(ws => ({ ws, href: workspaceLanding(ws, permissions, isOwner) }))
    .filter((w): w is { ws: Workspace; href: string } => w.href !== null)

  // Shared nav body, used by both the desktop rail and the mobile drawer.
  const nav = (
    <nav className="flex-1 overflow-y-auto py-3">
      {GROUPS.map(group => {
        const items = visible.filter(w => w.ws.group === group)
        if (items.length === 0) return null
        return (
          <div key={group} className="mb-4">
            <p className="px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-neutral-500)]">
              {group}
            </p>
            {items.map(({ ws, href }) => {
              const active = ws.key === activeKey
              const count = navCounts[ws.key]
              return (
                <Link
                  key={ws.key}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`grid grid-cols-[3px_1fr_auto] items-center gap-2.5 h-10 pr-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-signal)] focus-visible:-outline-offset-2 ${
                    active
                      ? 'bg-[var(--color-neutral-900)] text-white'
                      : 'text-[var(--color-neutral-500)] hover:bg-[var(--color-neutral-900)] hover:text-[var(--color-paper)]'
                  }`}
                >
                  {/* The red active-bar occupies the fixed 3px first column in
                      every state, so labels never shift when selection moves. */}
                  <span className={`h-full w-[3px] ${active ? 'bg-[var(--color-signal)]' : 'bg-transparent'}`} />
                  <span className="truncate">{ws.label}</span>
                  {/* Right column: the workspace count (tabular), muted, brighter
                      when the workspace is active. Empty when there's no count. */}
                  <span
                    className={`m-num text-xs ${active ? 'text-[var(--color-neutral-300)]' : 'text-[var(--color-neutral-500)]'}`}
                  >
                    {typeof count === 'number' ? count.toLocaleString() : ''}
                  </span>
                </Link>
              )
            })}
          </div>
        )
      })}
    </nav>
  )

  const footer = (
    <div className="flex-shrink-0">
      {/* RECORD — today's live activity total, links to the same page as the
          Today workspace's "Record" tab. Replaces the old notifications menu
          on desktop to match the App Shell rail. */}
      <Link
        href="/today/record"
        className="flex items-center justify-between gap-2 border-t-2 border-[var(--color-neutral-800)] px-4 py-3 transition-colors hover:bg-[var(--color-neutral-900)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-signal)] focus-visible:-outline-offset-2"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-neutral-300)]">Record</span>
        <span className="m-num text-xs text-[var(--color-neutral-500)]">{streamCount.toLocaleString()} today</span>
      </Link>
      <div className="border-t-2 border-[var(--color-neutral-800)] px-3 py-2.5">
        <UserMenu
          userName={userName}
          userEmail={userEmail}
          userRole={userRole}
          schoolName={schoolName}
          schoolLogoUrl={schoolLogoUrl}
          dropDirection="up"
        />
      </div>
    </div>
  )

  const brand = (
    <Link
      href="/today"
      className="block border-l-[5px] border-[var(--color-signal)] border-b-2 border-b-[var(--color-neutral-800)] pl-4 pr-4 pt-5 pb-[18px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-signal)] focus-visible:-outline-offset-2"
    >
      <span className="block text-[11px] font-extrabold uppercase tracking-[0.24em] text-[var(--color-paper)] leading-none">Fees</span>
      <span className="block text-[34px] font-extrabold tracking-[-0.045em] text-white leading-none mt-1 m-num">101</span>
    </Link>
  )

  return (
    <>
      {/* Desktop rail (lg and up). */}
      <aside className="hidden lg:flex w-[232px] flex-shrink-0 self-start sticky top-0 h-screen bg-[var(--color-ink)] flex-col z-40">
        {brand}
        {nav}
        {footer}
      </aside>

      {/* Mobile top bar (below lg). Fixed, so page content clears it via the
          layout's top padding and the sticky page header's mobile offset. */}
      <div className="lg:hidden fixed top-0 inset-x-0 h-14 z-50 bg-[var(--color-ink)] border-b-2 border-[var(--color-neutral-800)] flex items-center justify-between pl-1 pr-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="h-11 px-3 flex items-center text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--color-neutral-400)] hover:text-[var(--color-paper)]"
          >
            Menu
          </button>
          <Link href="/today" className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[var(--color-paper)] leading-none">Fees</span>
            <span className="text-[22px] font-extrabold tracking-[-0.045em] text-white leading-none m-num">101</span>
          </Link>
        </div>
        <NotificationsMenu notifications={notifications} dropDirection="down" compact align="right" />
      </div>

      {/* Mobile drawer. */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[80]">
          <div
            className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[260px] max-w-[85vw] bg-[var(--color-ink)] flex flex-col m-anim-slide">
            <div className="flex items-start justify-between">
              {brand}
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="h-11 px-3 flex items-center text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--color-neutral-400)] hover:text-[var(--color-paper)] flex-shrink-0"
              >
                Close
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}
    </>
  )
}
