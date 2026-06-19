'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import UserMenu from './UserMenu'

interface AppNavProps {
  userName: string
  userEmail: string
  userRole: string
  schoolName: string
  currentTermName: string
}

export default function AppNav({ userName, userEmail, userRole, schoolName, currentTermName }: AppNavProps) {
  const pathname = usePathname()

const navItems = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/students', label: 'Students' },
    { href: '/fees', label: 'Fees' },
  ]

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4">
    <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-6">
        
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-9 h-9 bg-navy rounded-lg flex items-center justify-center">
            <span className="text-mint font-bold text-base tracking-tight">F1</span>
          </div>
          <span className="text-navy font-bold text-lg tracking-tight">Fees<span className="text-mint">101</span></span>
        </Link>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-navy bg-mint-light'
                    : 'text-gray-600 hover:text-navy hover:bg-gray-50'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>

        {/* Right side: term selector + user menu */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-navy hover:bg-gray-50">
            <span className="font-medium">{currentTermName}</span>
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <UserMenu 
            userName={userName}
            userEmail={userEmail}
            userRole={userRole}
            schoolName={schoolName}
          />
        </div>
      </div>
    </nav>
  )
}