'use client'

import { useState } from 'react'

// "Download all my data" — fetches the owner-only full export route and saves
// the streamed .zip. Mirrors ExportCsvButton's save flow, but points at the
// data-privacy export route (which returns a zip, not a single CSV).
export default function ExportAllDataButton() {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch('/settings/data-privacy/export')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Export failed (${res.status})`)
      }
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : 'fees101-data-export.zip'

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={download}
        disabled={downloading}
        className="inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium py-2 px-3.5 bg-navy text-white hover:bg-navy/90 disabled:opacity-50 transition-colors self-start"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        {downloading ? 'Preparing your data…' : 'Download all my data (.zip)'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
