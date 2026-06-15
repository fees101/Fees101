'use client'

import { useState } from 'react'

interface UserMenuProps {
  userName: string
  userEmail: string
  userRole: string
  schoolName: string
}

export default function UserMenu({ userName, userEmail, userRole, schoolName }: UserMenuProps) {
  const [open, setOpen] = useState(false)

  const initials = userName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  async function handleLogout() {
    await fetch('/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <div className="w-8 h-8 bg-navy rounded-full flex items-center justify-center">
          <span className="text-white text-xs font-semibold">{initials}</span>
        </div>
      </button>

      {open && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <p className="text-navy font-semibold text-sm">{userName}</p>
              <p className="text-gray-500 text-xs mt-1">{userEmail}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">{schoolName}</span>
                <span className="text-xs px-2 py-0.5 bg-mint-light text-navy rounded-full capitalize">
                  {userRole.replace('_', ' ')}
                </span>
              </div>
            </div>
            <div className="py-1">
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}