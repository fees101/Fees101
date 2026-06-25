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

        {/* Right side: current term label + user menu */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {currentTermName && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Current term:</span>
              <span className="text-navy font-medium">{currentTermName}</span>
            </div>
          )}

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