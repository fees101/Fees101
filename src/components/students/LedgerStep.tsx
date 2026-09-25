import type { ReactNode } from 'react'

// The status a numbered ledger step can be in. Drives the colour of the number
// and the status word: done = completed (ink), attention = needs follow-up
// (ochre), running = in progress (ink), notrun = idle (neutral). Never ledger
// green here — these steps track wizard/setup progress, not money arriving.
export type StepStatus = 'notrun' | 'running' | 'attention' | 'done'

// A single numbered step line shared by the Import and Payment-accounts ledgers:
// the number (coloured by status) and title on the left, the status word flush
// right, then a description and a determinate progress rule. Any interactive
// content for the step (dropzone, problem table, confirm button) is passed as
// children, aligned under the title.
export function LedgerStep({
  n, title, status, statusLabel, desc, progress, showBar, children,
}: {
  n: string
  title: string
  status: StepStatus
  statusLabel: string
  desc?: string
  progress: number
  showBar: boolean
  children?: ReactNode
}) {
  const tone =
    status === 'done' ? 'var(--color-ink)'
    : status === 'attention' ? 'var(--color-ochre-text)'
    : status === 'running' ? 'var(--color-ink)'
    : 'var(--color-neutral-500)'
  const pct = Math.max(0, Math.min(1, progress)) * 100

  return (
    <div style={{ borderTop: '1px solid var(--color-neutral-300)', padding: '18px 0', display: 'grid', gridTemplateColumns: '34px 1fr', columnGap: 16 }}>
      <span className="m-num" style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', color: tone, lineHeight: '22px' }}>{n}</span>
      <div style={{ minWidth: 0 }}>
        <div className="flex items-baseline justify-between gap-4">
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>{title}</p>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tone, whiteSpace: 'nowrap' }}>{statusLabel}</span>
        </div>
        {desc && <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ margin: '6px 0 0', maxWidth: '74ch' }}>{desc}</p>}
        {showBar && (
          <div style={{ height: 3, background: 'var(--color-neutral-300)', maxWidth: 460, marginTop: 12 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-ink)', transition: 'width var(--dur-settle) var(--ease-out)' }} />
          </div>
        )}
        {children && <div style={{ marginTop: 16 }}>{children}</div>}
      </div>
    </div>
  )
}
