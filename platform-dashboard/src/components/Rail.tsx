'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Building2, Receipt, Activity,
  UserPlus, ScrollText, Settings,
} from '@/lib/icons'

// Left nav for the platform console. Order = the IA priority in
// docs/platform-dashboard-architecture.md §4. Home is the overview, not the
// school list — Schools sits one level below it.
const NAV = [
  { href: '/', label: 'Home', icon: LayoutDashboard, exact: true },
  { href: '/schools', label: 'Schools', icon: Building2 },
  { href: '/billing', label: 'Billing', icon: Receipt },
  { href: '/health', label: 'Payments & health', icon: Activity },
  { href: '/onboarding', label: 'Onboarding', icon: UserPlus },
  { href: '/audit', label: 'Audit log', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export default function Rail() {
  const pathname = usePathname()
  return (
    <nav className="rail-nav">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
        return (
          <Link key={href} href={href} className={`nav-item${active ? ' active' : ''}`}>
            <Icon size={17} strokeWidth={2} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
