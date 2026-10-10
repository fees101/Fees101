'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Building2, Receipt, Activity,
  UserPlus, ScrollText, Settings, Wallet,
} from '@/lib/icons'

// Left nav for the platform console, grouped (2026-10-10 restructure) the
// same way fees101-web's Modernist nav groups workspaces into Operate/
// Configure — a flush-left uppercase group label, not just a flat list — so
// the IA reads as one coherent tool instead of 8 same-weight links. Order
// within and across groups still follows the priority in
// docs/platform-dashboard-architecture.md §4 (Home is the overview, not the
// school list; Schools sits one level below it).
//
// Nested items (2026-10-10, second pass) — owner feedback: in-page tabs are
// fine for a quick-scan grouping (a few small lists), but wrong for a section
// that's itself a heavy, scrollable, filterable tool (a searchable/paginated
// explorer with its own detail view) — cramming that into a tab just moves
// the scrolling problem in by one level instead of solving it. Those sections
// are real sub-ROUTES instead, and the rail expands to show them once you're
// anywhere under that parent, so "what's in this section" is always visible
// without an in-page tab bar. `children` is optional — most items stay flat.
//
// Groups:
//  - Overview: the morning screen.
//  - Tenants: who the schools are and how they got here.
//  - Money: cross-school finance — both the existing per-tenant accrual/
//    collection view and the newer read-only oversight of refunds/manual
//    payments/discounts (2026-10-10) — deliberately NOT an approve/review
//    surface; that stays inside each school's own staff-facing app.
//  - Operations: engineer/on-call health (now split into real sub-pages —
//    Jobs / Webhooks / Rollovers — since each is its own explorer, not a
//    quick-scan list) + the cross-tenant audit trail.
//  - Settings: platform admins, billing-model reference, standalone.
interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
  exact?: boolean
  children?: { href: string; label: string }[]
}
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [{ href: '/', label: 'Home', icon: LayoutDashboard, exact: true }],
  },
  {
    label: 'Tenants',
    items: [
      { href: '/schools', label: 'Schools', icon: Building2 },
      { href: '/onboarding', label: 'Onboarding', icon: UserPlus },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/billing', label: 'Billing', icon: Receipt },
      { href: '/money', label: 'Money oversight', icon: Wallet },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/health', label: 'Payments & health', icon: Activity,
        children: [
          { href: '/health/jobs', label: 'Background jobs' },
          { href: '/health/webhooks', label: 'Webhook delivery' },
          { href: '/health/usage', label: 'Usage & outliers' },
          { href: '/health/rollovers', label: 'Year-end rollovers' },
          { href: '/health/provider-fees', label: 'Provider fee revenue' },
        ],
      },
      { href: '/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
  {
    label: 'Settings',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
]

export default function Rail() {
  const pathname = usePathname()
  return (
    <nav className="rail-nav">
      {GROUPS.map(group => (
        <div key={group.label}>
          <div className="rail-group-label">{group.label}</div>
          {group.items.map(({ href, label, icon: Icon, exact, children }) => {
            const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
            return (
              <div key={href}>
                <Link href={href} className={`nav-item${active ? ' active' : ''}`}>
                  <Icon size={17} strokeWidth={2} />
                  {label}
                </Link>
                {children && active && (
                  <div className="rail-subnav">
                    {children.map(c => {
                      const childActive = pathname === c.href || pathname.startsWith(c.href + '/')
                      return (
                        <Link key={c.href} href={c.href} className={`nav-item nav-item-sub${childActive ? ' active' : ''}`}>
                          {c.label}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
