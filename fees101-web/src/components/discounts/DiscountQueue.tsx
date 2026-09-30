'use client'

// The Discounts workspace, rebuilt to the App Shell canvas (disc:0 / disc:1).
// Two header modes share one surface: Queue (requests awaiting a decision) and
// Recurring (discounts running every term). Each mode is a table surface with a
// figure block on the right, a 2px ink header rule, hairline rows, and — where
// there's an action — it happens on the row itself, never in a centred modal.
//
// Recurring is a flat per-category report (CATEGORY/RULE/STUDENTS/COST-TERM),
// matching the canvas's disc:1 exactly — no per-student drill-down or revoke
// here; a school stops one student's recurring discount from that student's
// own profile (ApplyDiscountButton.tsx), which already has that control.

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import { approveDiscount, rejectDiscount, revokeDecidedDiscount } from '@/app/(app)/discounts/actions'
import type { PendingDiscountRequest, ActiveRecurringDiscount, DecidedDiscountRequest } from '@/lib/queries/discountRequests'
import Toast from '@/components/ui/Toast'

const CATEGORY_LABELS: Record<string, string> = {
  staff_child: 'Staff child',
  scholarship: 'Scholarship',
  bursary: 'Bursary',
  financial_hardship: 'Financial hardship',
  fee_waiver: 'Fee waiver',
  other: 'Other',
}

// Palette (App Shell tokens) — colour carries meaning: ochre = a cost or a
// decision waiting on a human, ink = neutral fact, dim = zero/inert.
const INK = 'var(--color-ink)'
const BODY = 'var(--color-neutral-800)'
const META = 'var(--color-neutral-700)'
const DIM = 'var(--color-neutral-500)'
const OCHRE = 'var(--color-ochre-text)'
const SIGNAL = 'var(--color-signal-text)'
const RULE_SOFT = 'var(--color-neutral-300)'

const COLS = 'minmax(0,2fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)'

// Mirrors RequestDiscountModal's threshold — surfaced again here since the
// approver may not be the person who requested it (2026-09-16 stress test:
// several individually-plausible discounts stacked to zero out a bill with
// no one warned at either step).
const CUMULATIVE_DISCOUNT_WARNING_THRESHOLD = 0.5

function projectedDiscountPercentage(req: PendingDiscountRequest): number | null {
  if (req.invoiceSubtotal <= 0) return null
  const thisAmount = req.isPercentage ? (req.invoiceSubtotal * req.amount) / 100 : req.amount
  const projected = Math.min(req.invoiceSubtotal, req.existingDiscountAmount + thisAmount)
  return (projected / req.invoiceSubtotal) * 100
}

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString('en-NG')}`
}

// What this request takes off the bill, in naira — used for the row value and
// the "if all approved" figure. A percentage is resolved against the invoice
// subtotal (capped at it), so the figure is a real money estimate.
function requestNairaValue(req: PendingDiscountRequest): number {
  if (!req.isPercentage) return req.amount
  if (req.invoiceSubtotal <= 0) return 0
  return Math.min(req.invoiceSubtotal, (req.invoiceSubtotal * req.amount) / 100)
}

function valueLabel(amount: number, isPercentage: boolean): string {
  return isPercentage ? `${amount}%` : naira(amount)
}

// A recurring discount's real naira cost — exact for a fixed amount, resolved
// against the student's current-term invoice subtotal for a percentage.
// Null means unresolvable (no active-cycle invoice yet), not zero.
function recurringNairaCost(s: ActiveRecurringDiscount): number | null {
  if (!s.isPercentage) return s.amount
  if (s.currentTermSubtotal == null) return null
  return Math.min(s.currentTermSubtotal, (s.currentTermSubtotal * s.amount) / 100)
}

type Mode = 'queue' | 'recurring'
type DecideStage = 'decide' | 'reject'

interface Props {
  requests: PendingDiscountRequest[]
  recurring: ActiveRecurringDiscount[]
  // Recently decided requests (approved or denied), shown below the pending
  // ones so a decision stays visible instead of disappearing from the Queue.
  decided: DecidedDiscountRequest[]
  // When false, decision controls are hidden (see-discounts without
  // approve-discounts). The server actions enforce this regardless.
  canApprove: boolean
}

interface RecurringGroup {
  category: string
  label: string
  students: ActiveRecurringDiscount[]
  count: number
  ruleLabel: string
  costLabel: string
  costInk: string
}

export default function DiscountQueue({ requests, recurring, decided, canApprove }: Props) {
  const router = useRouter()

  // Always lands on Queue — the workspace's job is "what needs a decision",
  // not "what's already running", even when the queue happens to be empty.
  const [mode, setMode] = useState<Mode>('queue')

  // Queue decision expander: which request is open, and whether we're on the
  // reject-reason step.
  const [decide, setDecide] = useState<{ id: string; stage: DecideStage } | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // DECIDED history: which approved row's Revoke confirm is open.
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)

  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const queueTotal = useMemo(
    () => requests.reduce((sum, r) => sum + requestNairaValue(r), 0),
    [requests],
  )

  const groups: RecurringGroup[] = useMemo(() => {
    const byCat = new Map<string, ActiveRecurringDiscount[]>()
    for (const d of recurring) {
      const arr = byCat.get(d.category) || []
      arr.push(d)
      byCat.set(d.category, arr)
    }
    return [...byCat.entries()]
      .map(([category, students]) => {
        const allFixed = students.every(s => !s.isPercentage)
        const allPct = students.every(s => s.isPercentage)
        let ruleLabel: string
        if (allFixed) {
          const amounts = new Set(students.map(s => s.amount))
          ruleLabel = amounts.size === 1 ? `${naira(students[0].amount)} off, every term` : 'Fixed amounts, every term'
        } else if (allPct) {
          const pcts = new Set(students.map(s => s.amount))
          ruleLabel = pcts.size === 1 ? `${students[0].amount}% off, every term` : 'Percentage-based, every term'
        } else {
          ruleLabel = 'Mixed value, every term'
        }

        // COST / TERM resolves every student's real ₦ figure it can — fixed
        // amounts always, percentages once that student's active-cycle invoice
        // subtotal is known (the same figure the discount is computed against
        // at generation time). A student with no invoice yet this term can't be
        // priced, so they're counted as pending rather than guessed at.
        let sum = 0
        let pending = 0
        for (const s of students) {
          const cost = recurringNairaCost(s)
          if (cost == null) pending += 1
          else sum += cost
        }
        const resolvedCount = students.length - pending
        let costLabel: string
        let costInk: string
        if (resolvedCount === 0) {
          const pcts = new Set(students.map(s => s.amount))
          costLabel = allPct && pcts.size === 1 ? `${students[0].amount}%` : 'Varies'
          costInk = META
        } else {
          costLabel = pending > 0 ? `${naira(sum)} (${pending} pending)` : naira(sum)
          costInk = OCHRE
        }

        return { category, label: CATEGORY_LABELS[category] || category, students, count: students.length, ruleLabel, costLabel, costInk }
      })
      .sort((a, b) => b.count - a.count)
  }, [recurring])

  // Headline figure for the Recurring surface — the canvas shows a resolved
  // ₦ total ("COST THIS TERM"), not a row count, so sum every student's real
  // cost the same way each group total does.
  const { recurringTotalCost, recurringTotalPending } = useMemo(() => {
    let sum = 0
    let pending = 0
    for (const s of recurring) {
      const cost = recurringNairaCost(s)
      if (cost == null) pending += 1
      else sum += cost
    }
    return { recurringTotalCost: sum, recurringTotalPending: pending }
  }, [recurring])

  function resetExpanders() {
    setDecide(null)
    setRejectReason('')
    setRevokeConfirmId(null)
    setError(null)
  }

  function switchMode(next: Mode) {
    if (next === mode) return
    resetExpanders()
    setMode(next)
  }

  function openDecide(id: string) {
    setError(null)
    setRejectReason('')
    setDecide(prev => (prev && prev.id === id ? null : { id, stage: 'decide' }))
  }

  async function handleApprove(id: string) {
    setError(null)
    setPendingId(id)
    const r = await approveDiscount(id)
    setPendingId(null)
    if ('error' in r && r.error) { setError(r.error); setResult({ ok: false, message: r.error }); return }
    resetExpanders()
    setResult({ ok: true, message: 'Discount approved.' })
    router.refresh()
  }

  async function handleReject(id: string) {
    setError(null)
    setPendingId(id)
    const r = await rejectDiscount(id, rejectReason)
    setPendingId(null)
    if ('error' in r && r.error) { setError(r.error); setResult({ ok: false, message: r.error }); return }
    resetExpanders()
    setResult({ ok: true, message: 'Discount rejected.' })
    router.refresh()
  }

  async function handleRevokeDecided(id: string) {
    setError(null)
    setPendingId(id)
    const r = await revokeDecidedDiscount(id)
    setPendingId(null)
    if ('error' in r) { setError(r.error); setResult({ ok: false, message: r.error }); return }
    setRevokeConfirmId(null)
    setResult({ ok: true, message: 'Discount revoked.' })
    router.refresh()
  }

  // Nothing anywhere — the true empty state. No tabs to switch between, so
  // WorkspaceHeader renders its plain single title.
  if (requests.length === 0 && recurring.length === 0 && decided.length === 0) {
    return (
      <>
        <WorkspaceHeader workspaceKey="discounts" title="Discounts" />
        <div className="px-4 sm:px-7 py-7">
          <div className="py-2" style={{ maxWidth: '60ch' }}>
            <p className="text-[17px] font-bold mb-2" style={{ color: INK }}>No discounts yet</p>
            <p className="text-[14px] leading-[1.55] mb-4" style={{ color: BODY }}>
              Nothing waiting on a decision, and nothing running every term. A discount is raised from a
              student&apos;s profile by staff who can request one; it then waits here for someone with approval
              rights to decide. Empty usually just means the school has not needed one yet.
            </p>
            <Link href="/students" className="m-btn m-btn-outline">Open a student</Link>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Mode switch — Queue / Recurring, matching the App Shell header modes.
          Rendered through WorkspaceHeader's own tabs slot (not a hand-built
          strip) so it merges with the header's closing rule the same way
          every route-tabbed workspace does, instead of drawing a second rule
          of its own right below it. */}
      <WorkspaceHeader
        workspaceKey="discounts"
        title="Discounts"
        tabs={[
          { label: 'Queue', active: mode === 'queue', onClick: () => switchMode('queue') },
          { label: 'Recurring', active: mode === 'recurring', onClick: () => switchMode('recurring') },
        ]}
      />

      <div className="px-4 sm:px-7 py-7">
      {error && (
        <div className="mt-4 pl-3 text-sm" style={{ borderLeft: `3px solid ${SIGNAL}`, color: SIGNAL }}>
          {error}
        </div>
      )}

      {mode === 'queue' ? (
        <Surface
          title="Requests awaiting a decision"
          body="Oldest first. Approving writes the discount onto the student's next invoice and re-issues it; it does not change an invoice already sent to a parent."
          figure={requests.length > 0 ? naira(queueTotal) : ''}
          figureLabel="IF ALL APPROVED"
          figureInk={OCHRE}
          head={[['STUDENT', 'left'], ['REASON', 'left'], ['VALUE', 'right'], ['', 'right']]}
        >
          {requests.length === 0 ? (
            <p className="text-sm py-4" style={{ color: META }}>Nothing waiting on a decision right now.</p>
          ) : (
            requests.map(req => {
              const pct = projectedDiscountPercentage(req)
              const warn = pct !== null && pct / 100 >= CUMULATIVE_DISCOUNT_WARNING_THRESHOLD
              const isOpen = decide?.id === req.id
              return (
                <Fragment key={req.id}>
                  <div className="grid items-baseline" style={{ gridTemplateColumns: COLS, gap: 14, padding: '12px 0', borderBottom: `1px solid ${RULE_SOFT}` }}>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/students/${req.studentId}`} className="text-[14px] font-semibold hover:underline" style={{ color: INK }}>
                        {req.studentName}
                      </Link>
                      <p className="text-[12px]" style={{ color: META, margin: '2px 0 0' }}>
                        {req.className}{req.requestedByName ? ` · raised by ${req.requestedByName}` : ''}
                      </p>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p className="text-[13px]" style={{ color: BODY, margin: 0 }}>{req.reason}</p>
                      <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>
                        {CATEGORY_LABELS[req.category] || req.category}{req.isRecurring ? ' · recurring' : ''} · off {req.cycleName}
                      </p>
                      {warn && (
                        <p className="text-[12px] font-semibold" style={{ color: OCHRE, margin: '3px 0 0' }}>
                          ~{Math.round(pct as number)}% of subtotal once stacked
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[14px] font-semibold m-num" style={{ color: OCHRE, margin: 0 }}>{naira(requestNairaValue(req))}</p>
                      {req.isPercentage && (
                        <p className="text-[12px] m-num" style={{ color: META, margin: '2px 0 0' }}>{req.amount}% of subtotal</p>
                      )}
                    </div>
                    <div className="text-right">
                      {canApprove ? (
                        <button onClick={() => openDecide(req.id)} className="text-[12px] font-semibold uppercase tracking-[0.08em] hover:underline" style={{ color: INK }}>
                          {isOpen ? 'Close' : 'Decide'}
                        </button>
                      ) : (
                        <Link href={`/money/invoices/${req.invoiceId}`} className="text-[12px] font-semibold uppercase tracking-[0.08em] hover:underline" style={{ color: INK }}>View</Link>
                      )}
                    </div>
                  </div>

                  {isOpen && canApprove && (
                    <div style={{ borderBottom: `1px solid ${RULE_SOFT}`, borderLeft: `2px solid ${INK}`, padding: '16px 0 18px 16px', margin: '0 0 0 0' }}>
                      <p className="text-[13px] font-semibold" style={{ color: INK, margin: '0 0 10px', maxWidth: '64ch' }}>
                        {req.studentName} — {CATEGORY_LABELS[req.category] || req.category} — &ldquo;{req.reason}&rdquo;
                      </p>
                      {decide?.stage === 'decide' ? (
                        <>
                          <p className="text-sm mb-3" style={{ color: INK, maxWidth: '64ch' }}>
                            Approving reduces {req.studentName}&apos;s next invoice by {valueLabel(req.amount, req.isPercentage)} ({naira(requestNairaValue(req))}) and recomputes it immediately. It does not change an invoice already sent.
                            {warn && ` Stacked with existing discounts this reaches ~${Math.round(pct as number)}% of the subtotal — worth a second look.`}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <button onClick={() => handleApprove(req.id)} disabled={pendingId === req.id} className="m-btn m-btn-primary m-btn-sm">
                              {pendingId === req.id ? 'Approving...' : `Approve ${valueLabel(req.amount, req.isPercentage)}`}
                            </button>
                            <button onClick={() => setDecide({ id: req.id, stage: 'reject' })} disabled={pendingId === req.id} className="text-[13px] font-semibold hover:underline disabled:opacity-40 disabled:no-underline" style={{ color: INK }}>
                              Reject
                            </button>
                            <Link href={`/money/invoices/${req.invoiceId}`} className="text-[13px] font-semibold hover:underline" style={{ color: INK }}>View invoice</Link>
                          </div>
                        </>
                      ) : (
                        <>
                          <label className="m-label">Reason for rejection (the requester sees this)</label>
                          <textarea
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            rows={2}
                            className="m-textarea mb-3"
                            style={{ maxWidth: '520px' }}
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleReject(req.id)} disabled={pendingId === req.id} className="m-btn m-btn-danger m-btn-sm">
                              {pendingId === req.id ? 'Rejecting...' : 'Reject request'}
                            </button>
                            <button onClick={() => setDecide({ id: req.id, stage: 'decide' })} disabled={pendingId === req.id} className="text-[13px] font-semibold hover:underline disabled:opacity-40 disabled:no-underline" style={{ color: INK }}>
                              Back
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </Fragment>
              )
            })
          )}

          {decided.length > 0 && (
            <>
              <p className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: META, margin: requests.length > 0 ? '20px 0 0' : '4px 0 0' }}>
                DECIDED
              </p>
              {decided.map(d => {
                const confirmingRevoke = revokeConfirmId === d.id
                return (
                  <Fragment key={d.id}>
                    <div className="grid items-baseline" style={{ gridTemplateColumns: COLS, gap: 14, padding: '12px 0', borderBottom: `1px solid ${RULE_SOFT}` }}>
                      <div style={{ minWidth: 0 }}>
                        <Link href={`/students/${d.studentId}`} className="text-[14px] font-semibold hover:underline" style={{ color: INK }}>
                          {d.studentName}
                        </Link>
                        <p className="text-[12px]" style={{ color: META, margin: '2px 0 0' }}>{d.className}</p>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <p className="text-[13px]" style={{ color: BODY, margin: 0 }}>{d.reason}</p>
                        <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>
                          {CATEGORY_LABELS[d.category] || d.category}{d.isRecurring ? ' · recurring' : ''} · off {d.cycleName}
                        </p>
                        {d.status === 'rejected' && d.rejectionReason && (
                          <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>&ldquo;{d.rejectionReason}&rdquo;</p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-[14px] font-semibold m-num" style={{ color: INK }}>{valueLabel(d.amount, d.isPercentage)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: d.status === 'applied' ? INK : META }}>
                          {d.status === 'applied' ? 'Approved' : d.status === 'revoked' ? 'Revoked' : 'Denied'}
                        </span>
                        {canApprove && d.canRevoke && !confirmingRevoke && (
                          <p style={{ margin: '4px 0 0' }}>
                            <button onClick={() => setRevokeConfirmId(d.id)} className="text-[11px] font-semibold uppercase tracking-[0.06em] hover:underline" style={{ color: SIGNAL }}>
                              Revoke?
                            </button>
                          </p>
                        )}
                        {d.decidedByName && (
                          <p className="text-[11px]" style={{ color: META, margin: '2px 0 0' }}>{d.decidedByName}</p>
                        )}
                      </div>
                    </div>

                    {confirmingRevoke && (
                      <div style={{ borderBottom: `1px solid ${RULE_SOFT}`, borderLeft: `2px solid ${INK}`, padding: '16px 0 18px 16px' }}>
                        <p className="text-sm mb-3" style={{ color: INK, maxWidth: '64ch' }}>
                          This stops {d.studentName}&apos;s {CATEGORY_LABELS[d.category] || d.category} discount. If the invoice it&apos;s on hasn&apos;t been sent or paid yet, it comes off immediately and the invoice recomputes; otherwise it just stops carrying forward to future invoices.
                        </p>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleRevokeDecided(d.id)} disabled={pendingId === d.id} className="m-btn m-btn-danger m-btn-sm">
                            {pendingId === d.id ? 'Revoking...' : 'Revoke?'}
                          </button>
                          <button onClick={() => setRevokeConfirmId(null)} disabled={pendingId === d.id} className="text-[13px] font-semibold hover:underline disabled:opacity-40 disabled:no-underline" style={{ color: INK }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </>
          )}
        </Surface>
      ) : (
        <Surface
          title="Discounts running every term"
          body="These apply automatically to every new invoice until someone removes them. Grouped by category — to stop one student's discount, remove it from that student's own profile."
          figure={recurring.length > 0 ? naira(recurringTotalCost) : ''}
          figureLabel="COST THIS TERM"
          figureInk={OCHRE}
          figureSub={recurringTotalPending > 0 ? `${recurringTotalPending} student${recurringTotalPending === 1 ? '' : 's'} not invoiced yet` : undefined}
          head={[['CATEGORY', 'left'], ['RULE', 'left'], ['STUDENTS', 'right'], ['COST / TERM', 'right']]}
          foot={groups.length > 0 ? `${groups[0].label} runs on the most students (${groups[0].count}).` : ''}
        >
          {recurring.length === 0 ? (
            <p className="text-sm py-4" style={{ color: META }}>Nothing running every term.</p>
          ) : (
            groups.map(g => (
              <div key={g.category} className="grid items-baseline" style={{ gridTemplateColumns: COLS, gap: 14, padding: '12px 0', borderBottom: `1px solid ${RULE_SOFT}` }}>
                <span className="text-[14px] font-semibold" style={{ color: INK }}>{g.label}</span>
                <span className="text-[13px]" style={{ color: BODY }}>{g.ruleLabel}</span>
                <span className="text-[14px] font-semibold m-num text-right" style={{ color: INK }}>{g.count}</span>
                <span className="text-[14px] font-semibold m-num text-right" style={{ color: g.costInk }}>{g.costLabel}</span>
              </div>
            ))
          )}
        </Surface>
      )}
      </div>

      {result && <Toast message={result.message} ok={result.ok} onDismiss={() => setResult(null)} />}
    </>
  )
}

// One table surface: 2px ink top rule, title + body on the left, an optional
// figure block on the right, a ruled grid header, the rows (children), and an
// optional ochre insight foot.
function Surface({
  title, body, figure, figureLabel, figureInk, figureSub, head, foot, children,
}: {
  title: string
  body: string
  figure: string
  figureLabel: string
  figureInk: string
  figureSub?: string
  head: [string, 'left' | 'right'][]
  foot?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 18 }}>
      <div className="flex flex-wrap items-end justify-between" style={{ gap: 20, marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h2 className="text-[25px] font-extrabold tracking-[-0.015em]" style={{ color: INK, margin: '0 0 4px' }}>{title}</h2>
          <p className="text-[14px]" style={{ color: BODY, margin: 0, maxWidth: '68ch' }}>{body}</p>
        </div>
        {figure && (
          <div className="text-right">
            <p className="text-[11px] tracking-[0.14em]" style={{ color: META, margin: '0 0 6px' }}>{figureLabel}</p>
            <p className="text-[30px] font-extrabold leading-none m-num" style={{ color: figureInk, margin: 0 }}>{figure}</p>
            {figureSub && <p className="text-[12px]" style={{ color: META, margin: '4px 0 0' }}>{figureSub}</p>}
          </div>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: COLS, gap: 14, padding: '0 0 8px', borderBottom: `2px solid ${INK}` }}>
        {head.map((h, i) => (
          <span key={i} className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: META, textAlign: h[1] }}>{h[0]}</span>
        ))}
      </div>

      {children}

      {foot && <p className="text-[14px] font-semibold" style={{ color: OCHRE, margin: '16px 0 0' }}>{foot}</p>}
    </div>
  )
}
