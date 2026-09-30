'use client'

import type { ReactNode } from 'react'

// The shared shell for every destructive/irreversible confirmation in the
// app — same structure as StudentSettingsTab's WithdrawConfirmModal (the
// canonical pattern): the action spelled out in words, concrete consequences
// itemized as ruled rows before the buttons, and every outcome its own
// button (no hidden default, no browser confirm(), no second dialog after
// the fact). Callers own their own async/loading state and pass finished
// button configs in; this component only renders the shell.

export interface DestructiveConfirmRow {
  label: string
  value: ReactNode
  valueClassName?: string
  /** Adds the heavier bottom rule used for the last row in a group (matches
   * the "Siblings still enrolled" cutoff row in WithdrawConfirmModal). */
  emphasize?: boolean
}

export interface DestructiveConfirmAction {
  label: string
  onClick: () => void
  variant?: 'outline' | 'danger' | 'primary'
  disabled?: boolean
}

interface Props {
  /** Small uppercase tag above the title, e.g. "This cannot be undone". */
  eyebrow?: string
  title: string
  /** Plain-language statement of what the action does. */
  description?: ReactNode
  rows?: DestructiveConfirmRow[]
  /** Trailing note after the rows, e.g. how/whether this can be reversed. */
  note?: ReactNode
  error?: string | null
  actions: DestructiveConfirmAction[]
}

export default function DestructiveConfirmModal({ eyebrow, title, description, rows, note, error, actions }: Props) {
  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
        <div className="p-6">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-signal-text)] mb-2">
              {eyebrow}
            </p>
          )}
          <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-2">{title}</h3>
          {description && (
            <p className="text-sm text-[var(--color-neutral-700)] mb-3">{description}</p>
          )}

          {rows && rows.length > 0 && (
            <div className="mb-1">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className={`border-t border-[var(--color-neutral-300)] py-2.5 flex items-center justify-between gap-3 ${
                    row.emphasize ? 'border-b-2 border-b-[var(--color-ink)]' : ''
                  }`}
                >
                  <span className="text-[13px] text-[var(--color-neutral-800)]">{row.label}</span>
                  <span className={row.valueClassName || 'text-sm font-semibold m-num text-[var(--color-ink)]'}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {note && (
            <p className="text-[13px] text-[var(--color-neutral-700)] mt-3">{note}</p>
          )}

          {error && (
            <div className="mt-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {error}
            </div>
          )}
        </div>
        <div className="p-6 border-t-2 border-[var(--color-ink)] flex flex-wrap items-center justify-end gap-2">
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={action.onClick}
              disabled={action.disabled}
              className={`m-btn m-btn-sm ${
                action.variant === 'danger' ? 'm-btn-danger' : action.variant === 'primary' ? 'm-btn-primary' : 'm-btn-outline'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
