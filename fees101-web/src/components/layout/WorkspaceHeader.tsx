'use client'

// The Modernist page header, shared by every workspace screen: a small crumb
// over a large title, an optional actions cluster on the right, and the
// workspace's in-page mode tabs. Modes come straight from navConfig and are
// filtered by the viewer's permissions, so a tab only shows when its route is
// reachable. A detail page passes `back` instead of a crumb and hides tabs.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePermissions } from '@/lib/auth/PermissionsProvider'
import { workspaces, accessibleModes, type NavMode } from '@/lib/nav/navConfig'

interface WorkspaceHeaderProps {
  // Which workspace this page belongs to (navConfig key), for its mode tabs.
  workspaceKey: string
  title: string
  // Overrides the default crumb (the workspace's group name).
  crumb?: string
  // Right-aligned action buttons/links for this screen.
  actions?: React.ReactNode
  // A detail page shows a "back to..." link in place of the crumb + tabs.
  back?: { href: string; label: string }
  // Force-hide the mode tabs even on a list page (rare).
  showTabs?: boolean
  // Client-state tabs for a workspace whose "modes" aren't separate routes
  // (e.g. Discounts' Queue/Recurring, one page, toggled in place). Renders in
  // the exact same slot as the route-based mode tabs below, so it gets the
  // same merged closing rule instead of a second one — takes priority over
  // navConfig modes when passed. Bare label only, no count: the canvas's own
  // `.tab` template never carries one (App Shell.dc.html:170).
  tabs?: { label: string; active: boolean; onClick: () => void }[]
}

function isModeActive(mode: NavMode, pathname: string): boolean {
  if (mode.exact) return pathname === mode.href
  return pathname === mode.href || pathname.startsWith(mode.href + '/')
}

export default function WorkspaceHeader({
  workspaceKey, title, crumb, actions, back, showTabs = true, tabs,
}: WorkspaceHeaderProps) {
  const pathname = usePathname()
  const { permissions, isOwner } = usePermissions()
  const ws = workspaces.find(w => w.key === workspaceKey)
  const modes = ws ? accessibleModes(ws, permissions, isOwner) : []
  const crumbText = crumb ?? ws?.group ?? ''
  const tabsVisible = showTabs && !back && (tabs ? tabs.length > 0 : modes.length > 1)
  // The workspace title is the WORKSPACE name (e.g. "Team & Trust", "Money"),
  // never the current mode's name — the active tab alone says which sub-view
  // you're on. A detail page (has a `back` crumb) keeps its own specific title
  // (a student's name, an invoice number), since it isn't a tabbed sub-view.
  const heading = back ? title : (ws?.label ?? title)

  return (
    <header className="sticky top-14 lg:top-0 z-30 bg-[var(--color-paper)] border-b-2 border-[var(--color-ink)]">
      <div className="px-4 sm:px-7 pt-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            {back ? (
              <Link
                href={back.href}
                className="inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]"
              >
                Back to {back.label}
              </Link>
            ) : crumbText ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-neutral-700)]">
                {crumbText}
              </p>
            ) : null}
            <h1 className="text-2xl sm:text-[30px] font-extrabold tracking-[-0.02em] text-[var(--color-ink)] leading-tight mt-1 text-balance">
              {heading}
            </h1>
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap pt-1">{actions}</div>}
        </div>

        {tabsVisible && (
          <div className="flex items-center gap-6 mt-3 -mb-[2px] overflow-x-auto">
            {tabs
              ? tabs.map(t => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={t.onClick}
                    data-active={t.active}
                    aria-current={t.active ? 'page' : undefined}
                    className="m-tab flex-shrink-0"
                  >
                    {t.label}
                  </button>
                ))
              : modes.map(m => {
                  const active = isModeActive(m, pathname)
                  return (
                    <Link
                      key={m.href}
                      href={m.href}
                      data-active={active}
                      aria-current={active ? 'page' : undefined}
                      className="m-tab flex-shrink-0"
                    >
                      {m.label}
                    </Link>
                  )
                })}
          </div>
        )}
      </div>
    </header>
  )
}
