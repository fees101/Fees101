'use client'

import { useEffect, useState } from 'react'
import { formatDate, formatDateTime } from '@/lib/format/date'

function timeAgo(iso: string): string {
  const then = new Date(iso)
  const diffMs = Date.now() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(iso)
}

// "5m ago" depends on the current moment, which differs between server render
// and client hydration and throws a text-mismatch warning. Render the stable
// absolute timestamp until mounted, then swap to the live relative string.
export default function RelativeTime({ iso }: { iso: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return <>{mounted ? timeAgo(iso) : formatDateTime(iso)}</>
}
