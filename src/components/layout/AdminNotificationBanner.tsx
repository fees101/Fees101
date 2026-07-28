'use client'

import { useState } from 'react'
import { dismissAdminNotification } from '@/app/(app)/notifications-actions'

export interface AdminNotificationItem {
  id: string
  title: string
  body: string
  createdAt: string
}

export default function AdminNotificationBanner({ notifications }: { notifications: AdminNotificationItem[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = notifications.filter(n => !dismissed.has(n.id))
  if (visible.length === 0) return null

  async function handleDismiss(id: string) {
    setDismissed(prev => new Set(prev).add(id))
    await dismissAdminNotification(id)
  }

  return (
    <div className="px-6 pt-4 space-y-2">
      {visible.map(n => (
        <div key={n.id} className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-navy">{n.title}</p>
            <p className="text-xs text-gray-600 mt-0.5">{n.body}</p>
          </div>
          <button
            onClick={() => handleDismiss(n.id)}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
