'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Shared "download this data as CSV" button. Hits /reports/export?type=… with
// whatever scope params the caller passes, then saves the streamed file using
// the filename the route sets. The route also logs the download for the audit
// history, so we refresh server components after a successful save to keep the
// Reports page history current. Used both on the Reports page and as a
// contextual export on the pages that already show the data.

interface Props {
  type: string
  params?: Record<string, string | undefined | null>
  label?: string
  variant?: 'primary' | 'secondary'
  className?: string
  block?: boolean
}

export default function ExportCsvButton({
  type,
  params = {},
  label = 'Export CSV',
  variant = 'secondary',
  className = '',
  block = false,
}: Props) {
  const router = useRouter()
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setDownloading(true)
    setError(null)
    try {
      const search = new URLSearchParams({ type })
      for (const [k, v] of Object.entries(params)) {
        if (v) search.set(k, v)
      }
      const res = await fetch(`/reports/export?${search.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Export failed (${res.status})`)
      }
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : `${type}.csv`

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      // Keep the Reports-page download history fresh after a successful save.
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Something went wrong')
    } finally {
      setDownloading(false)
    }
  }

  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium py-2 px-3.5 disabled:opacity-50 transition-colors'
  const tone =
    variant === 'primary'
      ? 'bg-navy text-white hover:bg-navy/90'
      : 'border border-gray-200 text-navy bg-white hover:bg-gray-50'

  return (
    <span className={`flex flex-col ${block ? 'items-stretch w-full' : 'inline-flex items-end'}`}>
      <button onClick={download} disabled={downloading} className={`${base} ${tone} ${className}`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        {downloading ? 'Preparing…' : label}
      </button>
      {error && <span className="text-xs text-red-500 mt-1">{error}</span>}
    </span>
  )
}
