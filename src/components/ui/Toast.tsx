'use client'

import { useEffect } from 'react'

interface Props {
  message: string
  // Optional bold heading above the message — used by the field-edit-drawer
  // save confirmation ("Change saved" / "{Field} — recorded in the audit log").
  // Plain single-line callers (role created, etc.) omit it.
  title?: string
  ok: boolean
  onDismiss: () => void
}

export default function Toast({ message, title, ok, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm">
      <div className={`flex items-start gap-3 p-4 bg-[var(--color-ink)] text-[var(--color-paper)] border-l-[5px] m-anim-slab ${ok ? 'border-[var(--color-paper)]' : 'border-[var(--color-signal)]'}`}>
        <div className="flex-1 min-w-0">
          {title && <p className="text-sm font-extrabold" style={{ margin: '0 0 2px' }}>{title}</p>}
          <p className="text-sm m-num" style={{ margin: 0, opacity: title ? 0.85 : 1 }}>{message}</p>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-400)] hover:text-[var(--color-paper)] flex-shrink-0">
          Dismiss
        </button>
      </div>
    </div>
  )
}
