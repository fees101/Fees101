'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import UserMenu from './UserMenu'

interface SidebarProps {
  userName: string
  userEmail: string
  userRole: string
  schoolName: string
  schoolLogoUrl?: string | null
  currentTermName: string | null
  currentTermId: string | null
}

interface NavItem {
  href: string
  label: string
  icon: string[]
  exact?: boolean
}

interface NavSection {
  title: string
  items: NavItem[]
}

const topItem: NavItem = {
  href: '/dashboard',
  label: 'Dashboard',
  icon: ['M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10'],
}

const sections: NavSection[] = [
  {
    title: 'School',
    items: [
      {
        href: '/settings/academic-structure',
        label: 'Academic structure',
        icon: [
          'M12 14l9-5-9-5-9 5 9 5z',
          'M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
        ],
      },
      {
        href: '/students',
        label: 'Students',
        icon: ['M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z'],
      },
    ],
  },
  {
    title: 'Fees',
    items: [
      {
        href: '/fees',
        label: 'Overview',
        exact: true,
        icon: ['M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14'],
      },
      {
        href: '/fees/structure',
        label: 'Fee structure',
        icon: ['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'],
      },
      {
        href: '/fees/cycles',
        label: 'Billing cycles',
        icon: ['M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'],
      },
      {
        href: '/invoices',
        label: 'Invoices',
        icon: ['M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'],
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        href: '/settings',
        label: 'School settings',
        icon: [
          'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
          'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
        ],
      },
    ],
  },
]

export default function Sidebar({
  userName, userEmail, userRole, schoolName, schoolLogoUrl, currentTermName, currentTermId,
}: SidebarProps) {
  const pathname = usePathname()
  // No pinned/persisted preference — the rail starts collapsed and expands
  // automatically on hover, closing again on mouse-leave or a click outside it.
  const [expanded, setExpanded] = useState(false)
  const asideRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!expanded) return
    function handleClickOutside(e: MouseEvent) {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [expanded])

  function isActive(item: NavItem) {
    return item.exact ? pathname === item.href : pathname.startsWith(item.href)
  }

  function NavLink({ item }: { item: NavItem }) {
    const active = isActive(item)
    return (
      <Link
        href={item.href}
        onClick={() => setExpanded(false)}
        title={!expanded ? item.label : undefined}
        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
          expanded ? '' : 'justify-center'
        } ${
          active ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
        }`}
      >
        <svg className={`w-4 h-4 flex-shrink-0 ${active ? 'text-mint' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          {item.icon.map((d, i) => <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
        </svg>
        {expanded && <span className="truncate">{item.label}</span>}
      </Link>
    )
  }

  return (
    <>
      {/* Spacer — reserves the rail's width in the page's flex layout.
          The real sidebar below is `fixed`, so it never scrolls away. */}
      <div className="w-16 flex-shrink-0" />

      <aside
        ref={asideRef}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className={`${expanded ? 'w-64 shadow-2xl' : 'w-16'} fixed top-0 left-0 h-screen z-40 bg-navy flex flex-col transition-all duration-150`}
      >
        {/* Header */}
        <div className={`px-4 py-4 border-b border-white/10 flex-shrink-0 ${expanded ? '' : 'flex justify-center'}`}>
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 bg-mint-light rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-navy font-bold text-base tracking-tight">F1</span>
            </div>
            {expanded && (
              <p className="text-white font-bold text-base tracking-tight truncate">
                Fees<span className="text-mint">101</span>
              </p>
            )}
          </Link>
        </div>

        {/* Current term */}
        {expanded && currentTermName && (
          <Link
            href={currentTermId ? `/fees/cycles/${currentTermId}` : '/fees/cycles'}
            onClick={() => setExpanded(false)}
            className="mx-3 mt-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5">Current term</p>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-mint flex-shrink-0" />
                <span className="text-sm font-semibold text-white truncate">{currentTermName}</span>
              </div>
              <svg className="w-3.5 h-3.5 text-white/40 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p className="text-xs text-white/40 mt-1">View billing cycles</p>
          </Link>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          <div className="space-y-1">
            <NavLink item={topItem} />
          </div>

          {sections.map(section => (
            <div key={section.title} className="space-y-1">
              {expanded && (
                <p className="px-2.5 text-[10px] font-semibold text-white/30 uppercase tracking-wider">
                  {section.title}
                </p>
              )}
              {section.items.map(item => <NavLink key={item.href} item={item} />)}
            </div>
          ))}
        </nav>

        {/* Footer: school branding + role, click for account menu */}
        <div className="border-t border-white/10 p-3 flex-shrink-0">
          <UserMenu
            userName={userName}
            userEmail={userEmail}
            userRole={userRole}
            schoolName={schoolName}
            schoolLogoUrl={schoolLogoUrl}
            dropDirection="up"
            collapsed={!expanded}
          />
        </div>
      </aside>
    </>
  )
}
