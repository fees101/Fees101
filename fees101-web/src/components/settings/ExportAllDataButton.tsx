'use client'

import { useState } from 'react'

interface Props {
  // 'button' (default): a standalone outline button, used inside the delete
  // dialog's "download first" step. 'row': the flush-right uppercase action
  // word used when this control sits inside a settings ledger row.
  variant?: 'button' | 'row'
}

// "Download all my data" — fetches the owner-only full export route and saves
// the streamed .zip. Mirrors ExportCsvButton's save flow, but points at the
// data-privacy export route (which returns a zip, not a single CSV).
export default function ExportAllDataButton({ variant = 'button' }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch('/team/data-privacy/export')
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
    <div className={variant === 'row' ? 'flex flex-col items-end gap-1' : 'flex flex-col gap-2'}>
      <button
        onClick={download}
        disabled={downloading}
        className={variant === 'row'
          ? 'text-[12px] font-bold tracking-[0.1em] text-[var(--color-ink)] hover:text-[var(--color-signal-text)] disabled:opacity-40 whitespace-nowrap'
          : 'm-btn m-btn-outline self-start'}
      >
        {downloading ? 'PREPARING...' : variant === 'row' ? 'EXPORT' : 'Download all my data (.zip)'}
      </button>
      {error && <span className="text-xs text-[var(--color-signal-text)]">{error}</span>}
    </div>
  )
}
