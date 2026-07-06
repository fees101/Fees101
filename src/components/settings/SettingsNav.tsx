'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  icon: string
  comingSoon?: boolean
}

interface NavSection {
  title: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    title: 'School',
    items: [
      {
        href: '/settings',
        label: 'School profile',
        icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
      },
      {
        href: '/settings/academic-structure',
        label: 'Academic structure',
        icon: 'M12 14l9-5-9-5-9 5 9 5z|M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
      },
    ],
  },
  {
    title: 'Team',
    items: [
      {
        href: '/settings/users',
        label: 'Users',
        icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
        comingSoon: true,
      },
      {
        href: '/settings/roles-permissions',
        label: 'Roles & permissions',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
        comingSoon: true,
      },
    ],
  },
  {
    title: 'Security',
    items: [
      {
        href: '/settings/audit-log',
        label: 'Audit log',
        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
        comingSoon: true,
      },
      {
        href: '/settings/data-privacy',
        label: 'Data & privacy',
        icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
        comingSoon: true,
      },
      {
        href: '/settings/account-security',
        label: 'Account security',
        icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
      },
    ],
  },
]

export default function SettingsNav() {
  const pathname = usePathname()
  const [search, setSearch] = useState('')

  const term = search.trim().toLowerCase()
  const filteredSections = term
    ? SECTIONS.map(section => ({
        ...section,
        items: section.items.filter(item => item.label.toLowerCase().includes(term)),
      })).filter(section => section.items.length > 0)
    : SECTIONS

  return (
    <div className="w-full lg:w-64 flex-shrink-0 space-y-5 lg:sticky lg:top-6">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search settings..."
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mint/40"
        />
      </div>

      {filteredSections.length === 0 ? (
        <p className="text-sm text-gray-400 px-1">No settings match &quot;{search}&quot;.</p>
      ) : (
        filteredSections.map(section => (
          <div key={section.title}>
            <p className="px-2.5 mb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map(item => {
                const active = pathname === item.href
                const iconPaths = item.icon.split('|')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                      active ? 'bg-mint-light text-navy font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-navy'
                    }`}
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      {iconPaths.map((d, i) => <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
                    </svg>
                    <span className="truncate flex-1">{item.label}</span>
                    {item.comingSoon && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded-full flex-shrink-0">
                        Soon
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
