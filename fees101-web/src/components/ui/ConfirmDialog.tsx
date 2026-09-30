'use client'

import { useState } from 'react'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-sm w-full m-anim-scale">
        <div className="p-6">
          <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-2">{title}</h3>
          <p className="text-sm text-[var(--color-neutral-700)] m-num">{message}</p>

          {error && (
            <div className="mt-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="m-btn m-btn-outline m-btn-sm"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`m-btn m-btn-sm ${destructive ? 'm-btn-danger' : 'm-btn-primary'}`}
          >
            {loading ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}