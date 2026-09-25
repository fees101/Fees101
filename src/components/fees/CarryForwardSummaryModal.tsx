'use client'

// Shown after a term is activated or closed and outstanding balances have been
// carried forward onto the next term. Presentational only: it reports what the
// server action already did. Shared by the Cycles list (inline activate/close)
// and the per-term hub (activate from a draft's prepare surface) so both read
// identically.
interface Props {
  mode: 'activated' | 'closed'
  closedTermName: string | null
  invoicesUpdated: number
  invoicesNeedingResend: number
  studentsWithCarryForward: number
  totalCarryForward: number
  showFinancials?: boolean
  onClose: () => void
}

export default function CarryForwardSummaryModal({
  mode,
  closedTermName,
  invoicesUpdated,
  invoicesNeedingResend,
  studentsWithCarryForward,
  totalCarryForward,
  showFinancials = true,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4">
      <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-lg w-full m-anim-scale">
        <div className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-[var(--color-ink)]">
                {mode === 'activated' ? 'Term activated' : 'Term closed'}
              </h3>
              {mode === 'activated' && closedTermName && (
                <p className="text-sm text-[var(--color-neutral-700)] mt-0.5">
                  {closedTermName} has been closed.
                </p>
              )}
            </div>
          </div>
          <div className="bg-[var(--color-surface)] p-4 space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--color-neutral-700)]">Students with outstanding balance</span>
              <span className="font-semibold text-[var(--color-ink)] m-num">{studentsWithCarryForward}</span>
            </div>
            {showFinancials && (
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-neutral-700)]">Total carry-forward</span>
                <span className="font-semibold text-[var(--color-ink)] m-num">
                  ₦{totalCarryForward.toLocaleString('en-NG')}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm pt-2 border-t border-[var(--color-neutral-300)]">
              <span className="text-[var(--color-neutral-700)]">Invoices auto-updated</span>
              <span className="font-semibold text-[var(--color-ink)] m-num">{invoicesUpdated}</span>
            </div>
          </div>
          {invoicesNeedingResend > 0 && (
            <div className="pl-3 py-2 border-l-2 border-[var(--color-ochre)] text-sm text-[var(--color-ochre-text)] mb-4">
              <strong>{invoicesNeedingResend}</strong> of these invoices were already sent to parents. They now need resending with the updated totals.
            </div>
          )}
          {studentsWithCarryForward > invoicesUpdated && (
            <div className="pl-3 py-2 border-l-2 border-[var(--color-neutral-300)] text-sm text-[var(--color-neutral-700)] mb-4">
              Note: {studentsWithCarryForward - invoicesUpdated} students didn&apos;t have an invoice yet in a future term. When one is generated for them, the carry-forward will be included automatically.
            </div>
          )}
        </div>
        <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end">
          <button onClick={onClose} className="m-btn m-btn-primary">Got it</button>
        </div>
      </div>
    </div>
  )
}
