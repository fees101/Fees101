'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import UserMenu from './UserMenu'
import { usePermissions } from '@/lib/auth/PermissionsProvider'
import { type NavItem, topItem, sections, canSeeNavItem, showsDashboardLink } from '@/lib/nav/navConfig'

interface SidebarProps {
  userName: string
  userEmail: string
  userRole: string
  schoolName: string
  schoolLogoUrl?: string | null
  currentTermName: string | null
  currentTermId: string | null
}

export default function Sidebar({
  userName, userEmail, userRole, schoolName, schoolLogoUrl, currentTermName, currentTermId,
}: SidebarProps) {
  const pathname = usePathname()
  const { permissions, isOwner } = usePermissions()
  const canSee = (item: NavItem) => canSeeNavItem(item, permissions, isOwner)
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
        className={`flex items-center rounded-lg text-sm font-medium transition-colors ${
          active ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
        }`}
      >
        {/* Fixed 40px icon slot = the collapsed rail's inner width, so the icon
            sits at the exact same x whether collapsed or expanded. Expanding
            only reveals the label to its right; the icon never moves. */}
        <span className="w-10 h-9 flex items-center justify-center flex-shrink-0">
          <svg className={`w-4 h-4 ${active ? 'text-mint' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            {item.icon.map((d, i) => <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
          </svg>
        </span>
        {expanded && <span className="truncate pr-3">{item.label}</span>}
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
        className={`${expanded ? 'w-64 shadow-2xl' : 'w-16'} fixed top-0 left-0 h-screen z-40 bg-navy flex flex-col`}
      >
        {/* Header */}
        <div className="px-3 py-4 border-b border-white/10 flex-shrink-0">
          <Link href="/dashboard" className="flex items-center">
            <span className="w-10 flex justify-center flex-shrink-0">
              <span className="w-9 h-9 bg-mint-light rounded-lg flex items-center justify-center">
                <span className="text-navy font-bold text-base tracking-tight">F1</span>
              </span>
            </span>
            {expanded && (
              <p className="text-white font-bold text-base tracking-tight truncate ml-1">
                Fees<span className="text-mint">101</span>
              </p>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {showsDashboardLink(permissions, isOwner) && (
            <div className="space-y-1">
              <NavLink item={topItem} />
            </div>
          )}

          {sections.map(section => {
            const items = section.items.filter(canSee)
            if (items.length === 0) return null
            return (
            <div key={section.title} className="space-y-1">
              {/* Reserve the label's height in BOTH states so nav items never
                  move vertically when the rail expands on hover — collapsed
                  shows a centered divider in the same 20px slot. */}
              <div className="h-5 flex items-center px-2.5">
                {expanded
                  ? <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{section.title}</span>
                  : <span className="mx-auto w-5 h-px bg-white/10" />}
              </div>
              {items.map(item => <NavLink key={item.href} item={item} />)}
            </div>
            )
          })}
        </nav>

        {/* Current term — sits BELOW the nav (nav is flex-1, top-aligned) so
            appearing on expand never pushes the nav items down. */}
        {expanded && currentTermName && (
          <Link
            href={currentTermId ? `/fees/cycles/${currentTermId}` : '/fees/cycles'}
            onClick={() => setExpanded(false)}
            className="mx-3 mb-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex-shrink-0"
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
