'use client'

import { useState } from 'react'

interface UserMenuProps {
  userName: string
  userEmail: string
  userRole: string
  schoolName: string
  schoolLogoUrl?: string | null
  dropDirection?: 'down' | 'up'
  collapsed?: boolean
}

function getInitials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export default function UserMenu({
  userName, userEmail, userRole, schoolName, schoolLogoUrl,
  dropDirection = 'down', collapsed = false,
}: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const schoolInitials = getInitials(schoolName)
  const roleLabel = userRole.replace('_', ' ')

  async function handleLogout() {
    await fetch('/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <div className="relative w-full">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors ${collapsed ? 'justify-center' : ''}`}
      >
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {schoolLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={schoolLogoUrl} alt={schoolName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-mint text-xs font-bold">{schoolInitials}</span>
          )}
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[13px] font-medium text-white leading-snug line-clamp-2 break-words">
                {schoolName}
              </p>
              <p className="text-xs text-white/40 capitalize">{roleLabel}</p>
            </div>
            <svg className="w-4 h-4 text-white/40 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />

          {/* Dropdown */}
          <div className={`absolute w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden ${
            dropDirection === 'up' ? 'left-0 bottom-full mb-2' : 'right-0 mt-2'
          }`}>
            <div className="p-4 border-b border-gray-100">
              <p className="text-navy font-semibold text-sm">{userName}</p>
              <p className="text-gray-500 text-xs mt-1">{userEmail}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">{schoolName}</span>
                <span className="text-xs px-2 py-0.5 bg-mint-light text-navy rounded-full capitalize">
                  {roleLabel}
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
