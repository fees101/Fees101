'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import UserMenu from './UserMenu'

interface AppNavProps {
  userName: string
  userEmail: string
  userRole: string
  schoolName: string
}

export default function AppNav({ userName, userEmail, userRole, schoolName }: AppNavProps) {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/students', label: 'Students' },
    { href: '/fees', label: 'Fees' },
    { href: '/settings', label: 'Settings' },
  ]

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-9 h-9 bg-navy rounded-lg flex items-center justify-center">
            <span className="text-mint font-bold text-base tracking-tight">F1</span>
          </div>
          <span className="text-navy font-bold text-lg tracking-tight">Fees<span className="text-mint">101</span></span>
        </Link>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-1">
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

        {/* User menu */}
        <UserMenu 
          userName={userName}
          userEmail={userEmail}
          userRole={userRole}
          schoolName={schoolName}
        />
      </div>
    </nav>
  )
}