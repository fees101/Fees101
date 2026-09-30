'use client'

// Shared right-edge slide-over shell for a single-field settings edit — same
// 420px shell as FeeFormPanel/RequestDiscountModal. Matches the App Shell
// canvas's generic field-edit drawer: Current / (field-specific) New value /
// an optional field-impact note / Reason (optional) / "Recorded as X" /
// Save change + Cancel.
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', marginBottom: 5, color: 'var(--color-ink)' }}>
      {children}
    </span>
  )
}

// Shared "Choose one" list for a field-edit drawer's body — bordered box of
// selectable rows, each with a 14×14 ink-bordered mark that fills when
// selected. `render` lets one row (e.g. "Custom") carry an inline control.
export function ChoiceList<T extends string>({ options, value, onChange, disabled }: {
  options: { value: T; label: string; render?: React.ReactNode }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div style={{ border: '2px solid var(--color-ink)', background: '#fff', opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      {options.map(opt => {
        const selected = value === opt.value
        return (
          <div
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderBottom: '1px solid var(--color-neutral-300)',
              cursor: 'pointer',
              background: selected ? 'var(--color-surface)' : 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{ width: 14, height: 14, flexShrink: 0, border: '2px solid var(--color-ink)', background: selected ? 'var(--color-ink)' : 'transparent' }}
            />
            <span className="text-[14px]" style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{opt.label}</span>
            {opt.render}
          </div>
        )
      })}
    </div>
  )
}

// Shared "Tick everyone allowed" list for a field-edit drawer's body —
// multi-select variant of ChoiceList, using a square tick mark instead of a
// single round one. `locked` keeps an option always checked and inert (SMS,
// which can't be turned off); `disabled` greys one out with a trailing badge
// (WhatsApp, not built yet) rather than letting it be picked.
export function CheckList<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; locked?: boolean; disabled?: boolean; badge?: string }[]
  value: T[]
  onChange: (v: T[]) => void
}) {
  return (
    <div style={{ border: '2px solid var(--color-ink)', background: '#fff' }}>
      {options.map(opt => {
        const checked = opt.locked || value.includes(opt.value)
        const interactive = !opt.locked && !opt.disabled
        return (
          <div
            key={opt.value}
            onClick={() => {
              if (!interactive) return
              onChange(checked ? value.filter(v => v !== opt.value) : [...value, opt.value])
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderBottom: '1px solid var(--color-neutral-300)',
              cursor: interactive ? 'pointer' : 'default',
              opacity: opt.disabled ? 0.45 : 1,
              background: checked && interactive ? 'var(--color-surface)' : 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{ width: 14, height: 14, flexShrink: 0, border: '2px solid var(--color-ink)', background: checked ? 'var(--color-ink)' : 'transparent' }}
            />
            <span className="text-[14px]" style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{opt.label}</span>
            {opt.badge && (
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>
                {opt.badge}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  title: string
  subtitle: string
  currentDisplay: React.ReactNode
  note?: string
  reason: string
  onReasonChange: (value: string) => void
  actorName: string
  onClose: () => void
  onSave: () => void
  saving?: boolean
  error?: string | null
  saveLabel?: string
  children: React.ReactNode
}

export default function FieldEditDrawer({
  title, subtitle, currentDisplay, note, reason, onReasonChange, actorName,
  onClose, onSave, saving, error, saveLabel = 'Save change', children,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex m-anim-fade">
      <div
        className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
        onClick={onClose}
      />
      <aside
        style={{ width: '420px', maxWidth: '100%' }}
        className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
          >
            Close
          </button>
        </div>
        <p className="text-[13px] leading-relaxed mb-5 text-[var(--color-neutral-700)]">{subtitle}</p>

        <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Current</SectionLabel>
            <div className="text-[14px]" style={{ background: 'var(--color-surface)', border: '2px solid var(--color-neutral-300)', padding: '10px 12px', color: 'var(--color-neutral-700)' }}>
              {currentDisplay}
            </div>
          </div>

          {children}

          {note && (
            <p className="text-[12px] leading-relaxed text-[var(--color-neutral-700)]" style={{ marginBottom: 16 }}>{note}</p>
          )}

          <div style={{ marginBottom: 18 }}>
            <SectionLabel>Reason (optional)</SectionLabel>
            <input
              type="text"
              value={reason}
              onChange={e => onReasonChange(e.target.value)}
              placeholder="Shown in the audit log"
              className="m-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 14, marginBottom: 18 }}>
            <p className="text-[12px]" style={{ margin: 0, lineHeight: 1.5, color: 'var(--color-neutral-700)' }}>
              Recorded as <strong style={{ color: 'var(--color-ink)' }}>{actorName}</strong> in Team &amp; Trust → Audit log.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 text-sm text-[var(--color-signal-text)]" style={{ borderLeft: '3px solid var(--color-signal)' }}>
              {error}
            </div>
          )}

          <div className="flex items-center gap-[10px]">
            <button onClick={onSave} disabled={saving} className="m-btn m-btn-primary" style={{ flex: 1 }}>
              {saving ? 'Saving...' : saveLabel}
            </button>
            <button onClick={onClose} disabled={saving} className="m-btn m-btn-outline">Cancel</button>
          </div>
        </div>
      </aside>
    </div>
  )
}
