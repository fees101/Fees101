'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Toast from '@/components/ui/Toast'
import {
  refundMethodLabel,
  refundCategoryLabel,
  type PendingRefund,
  type DecidedRefund,
} from '@/lib/refunds/display'
import { approveRefund, rejectRefund, confirmExternalRefund } from '@/app/(app)/money/refunds/actions'

const INK = 'var(--color-ink)'
const BODY = 'var(--color-neutral-800)'
const META = 'var(--color-neutral-700)'
const DIM = 'var(--color-neutral-500)'
const OCHRE = 'var(--color-ochre-text)'
const LEDGER = 'var(--color-ledger)'
const SIGNAL = 'var(--color-signal-text)'
const RULE_SOFT = 'var(--color-neutral-300)'

const COLS_GRID = 'sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]'
const FOCUS = 'focus-visible:outline-none focus-visible:[outline:2px_solid_var(--color-signal)] focus-visible:[outline-offset:2px]'

function naira(n: number): string {
  return `₦${Math.round(Math.abs(n)).toLocaleString('en-NG')}`
}

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Plain-language age for the ORIGINAL payment — context for whoever's
// deciding, since this app deliberately allows refunding a payment from an
// already-closed term (same reasoning a late payment can still apply to a
// closed term's invoice). Never used to block anything, just shown.
function age(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`
  const years = Math.floor(months / 12)
  return years === 1 ? '1 year ago' : `${years} years ago`
}

type Tab = 'pending' | 'history'

interface Props {
  pending: PendingRefund[]
  // Naira total of the full pending set "if all approved" — computed
  // server-side in getPendingRefunds, not re-derived here.
  total: number
  decided: DecidedRefund[]
  canApprove: boolean
}

// No "Record" tab, unlike manual payments — a refund always starts from an
// existing payment (the "Refund this payment" entry point on the student's
// activity timeline opens the request drawer there), never a blank form here.
export default function RefundsWorkspace({ pending, total, decided, canApprove }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('pending')
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)

  const tabs: { key: Tab; label: React.ReactNode }[] = [
    {
      key: 'pending',
      label: <>Pending{pending.length > 0 && <span className="m-num"> ({pending.length})</span>}</>,
    },
    { key: 'history', label: 'History' },
  ]

  return (
    <div className="px-4 sm:px-7 py-7">
      <div className="flex flex-wrap items-center gap-6" style={{ borderBottom: `1px solid ${RULE_SOFT}`, marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            data-active={tab === t.key}
            aria-current={tab === t.key ? 'page' : undefined}
            className="m-tab"
            style={{ marginBottom: -1 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <PendingList
          pending={pending}
          total={total}
          canApprove={canApprove}
          onResult={(ok, message) => { setToast({ ok, message }); if (ok) router.refresh() }}
        />
      )}

      {tab === 'history' && <HistoryList decided={decided} />}

      {toast && <Toast message={toast.message} ok={toast.ok} onDismiss={() => setToast(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pending list
// ---------------------------------------------------------------------------

function PendingList({
  pending, total, canApprove, onResult,
}: {
  pending: PendingRefund[]
  total: number
  canApprove: boolean
  onResult: (ok: boolean, message: string) => void
}) {
  const [open, setOpen] = useState<{ id: string; stage: 'decide' | 'reject' } | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function approve(p: PendingRefund) {
    setError(null); setBusyId(p.id)
    const r = p.initiatedExternally ? await confirmExternalRefund(p.id) : await approveRefund(p.id)
    setBusyId(null)
    if ('error' in r) { setError(r.error); onResult(false, r.error); return }
    setOpen(null)
    onResult(true, p.initiatedExternally ? 'Confirmed — your records now match Paystack.' : 'Refund approved.')
  }

  async function reject(id: string) {
    setError(null); setBusyId(id)
    const r = await rejectRefund(id, rejectNote)
    setBusyId(null)
    if ('error' in r) { setError(r.error); onResult(false, r.error); return }
    setOpen(null); setRejectNote('')
    onResult(true, 'Request rejected.')
  }

  return (
    <Surface
      title="Waiting for a decision"
      body={canApprove
        ? 'Refunds other staff have requested, oldest first. Approving a Paystack refund starts it immediately; approving a bank transfer refund records money the school has already sent.'
        : 'Refunds waiting for someone with approval rights to sign off. You requested these; they are processed once approved.'}
      figure={total > 0 ? naira(total) : ''}
      figureLabel="IF ALL APPROVED"
      figureInk={OCHRE}
      head={[['STUDENT', 'left'], ['DETAIL', 'left'], ['AMOUNT', 'right'], ['', 'right']]}
    >
      {pending.length === 0 ? (
        <p className="text-sm py-4" style={{ color: META }}>Nothing waiting on a decision right now.</p>
      ) : (
        pending.map(p => {
          const isOpen = open?.id === p.id
          return (
            <Fragment key={p.id}>
              <div className={`grid grid-cols-1 ${COLS_GRID} items-baseline`} style={{ gap: 14, padding: '12px 0', borderBottom: `1px solid ${RULE_SOFT}` }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/students/${p.studentId}`} className="text-[14px] font-semibold hover:underline" style={{ color: INK }}>
                    {p.studentName}
                  </Link>
                  <p className="text-[12px]" style={{ color: p.initiatedExternally ? SIGNAL : META, margin: '2px 0 0', fontWeight: p.initiatedExternally ? 700 : 400 }}>
                    {p.className}{p.initiatedExternally ? ' · detected on Paystack, not requested through Fees101' : (p.requestedByName ? ` · requested by ${p.requestedByName}` : '')}
                  </p>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="text-[13px]" style={{ color: BODY, margin: 0 }}>
                    {refundMethodLabel(p.refundMethod)}{p.cycleName ? ` · ${p.cycleName}` : ''}
                  </p>
                  <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>
                    {refundCategoryLabel(p.category)}{p.refundReference ? ` · ref ${p.refundReference}` : ''}
                  </p>
                  {p.paymentPaidAt && (
                    <p className="text-[12px] m-num" style={{ color: META, margin: '3px 0 0' }}>
                      Payment made {age(p.paymentPaidAt)} ({when(p.paymentPaidAt)})
                    </p>
                  )}
                  <p className="text-[12px] m-num" style={{ color: META, margin: '3px 0 0' }}>
                    Requested {when(p.requestedAt)}
                  </p>
                  <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>&ldquo;{p.reason}&rdquo;</p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold m-num" style={{ color: OCHRE, margin: 0 }}>-{naira(p.amount)}</p>
                </div>
                <div className="text-right">
                  {canApprove ? (
                    <button
                      onClick={() => { setError(null); setRejectNote(''); setOpen(isOpen ? null : { id: p.id, stage: 'decide' }) }}
                      className={`text-[12px] font-semibold uppercase tracking-[0.08em] hover:underline ${FOCUS}`}
                      style={{ color: INK }}
                    >
                      {isOpen ? 'Close' : 'Decide'}
                    </button>
                  ) : (
                    <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: META }}>Pending</span>
                  )}
                </div>
              </div>

              {isOpen && canApprove && (
                <div style={{ borderBottom: `1px solid ${RULE_SOFT}`, borderLeft: `2px solid ${INK}`, padding: '16px 0 18px 16px' }}>
                  {open?.stage === 'decide' ? (
                    <>
                      <p className="text-sm mb-3" style={{ color: INK, maxWidth: '64ch' }}>
                        {p.initiatedExternally
                          ? `Paystack reports ${naira(p.amount)} was ${p.refundMethod === 'chargeback' ? 'taken back via a card dispute' : 'refunded'} on ${p.studentName}'s payment, outside Fees101. Confirming updates this invoice/credit balance to match — the money has already moved either way.`
                          : p.refundMethod === 'paystack_reversal'
                          ? `Approving starts a Paystack refund of ${naira(p.amount)} to ${p.studentName}'s family, funded from the school's Paystack balance.`
                          : `Approving records a ${naira(p.amount)} refund already sent to ${p.studentName}'s family from the school's own bank, and notifies them.`}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => approve(p)} disabled={busyId === p.id} className="m-btn m-btn-primary m-btn-sm">
                          {busyId === p.id ? (p.initiatedExternally ? 'Confirming...' : 'Approving...') : (p.initiatedExternally ? 'Confirm' : 'Approve')}
                        </button>
                        <button onClick={() => setOpen({ id: p.id, stage: 'reject' })} disabled={busyId === p.id} className={`text-[13px] font-semibold hover:underline disabled:opacity-40 disabled:no-underline ${FOCUS}`} style={{ color: INK }}>
                          {p.initiatedExternally ? 'Dismiss' : 'Reject'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label htmlFor="rf-reject-note" className="m-label">
                        {p.initiatedExternally ? 'Why dismiss this (kept for the record)' : 'Reason for rejection (the requester sees this)'}
                      </label>
                      <textarea id="rf-reject-note" value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2} className="m-textarea mb-3" style={{ maxWidth: 520 }} autoFocus />
                      <div className="flex items-center gap-2">
                        <button onClick={() => reject(p.id)} disabled={busyId === p.id} className="m-btn m-btn-danger m-btn-sm">
                          {busyId === p.id ? 'Saving...' : (p.initiatedExternally ? 'Dismiss' : 'Reject request')}
                        </button>
                        <button onClick={() => setOpen({ id: p.id, stage: 'decide' })} disabled={busyId === p.id} className={`text-[13px] font-semibold hover:underline disabled:opacity-40 disabled:no-underline ${FOCUS}`} style={{ color: INK }}>
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

      {error && (
        <div className="mt-3 pl-3 text-sm" style={{ borderLeft: `3px solid ${SIGNAL}`, color: SIGNAL }}>{error}</div>
      )}
    </Surface>
  )
}

// ---------------------------------------------------------------------------
// History list
// ---------------------------------------------------------------------------

function HistoryList({ decided }: { decided: DecidedRefund[] }) {
  return (
    <Surface
      title="Decided refunds"
      body="Every refund that has been decided, newest first."
      figure=""
      figureLabel=""
      figureInk={INK}
      head={[['STUDENT', 'left'], ['DETAIL', 'left'], ['AMOUNT', 'right'], ['', 'right']]}
    >
      {decided.length === 0 ? (
        <p className="text-sm py-4" style={{ color: META }}>Nothing decided yet.</p>
      ) : (
        decided.map(d => {
          const statusLabel = d.status === 'rejected' ? 'Rejected'
            : d.status === 'failed' ? 'Failed'
            : d.status === 'processing' ? 'Processing'
            : d.autoApproved ? 'Processed' : 'Completed'
          // Ledger green only once the money has actually moved; a rejected/
          // failed request is inert (dim), a still-processing one is ochre
          // (awaiting Paystack's confirmation).
          const amountInk = d.status === 'completed' ? LEDGER : d.status === 'processing' ? OCHRE : DIM
          return (
            <div key={d.id} className={`grid grid-cols-1 ${COLS_GRID} items-baseline`} style={{ gap: 14, padding: '12px 0', borderBottom: `1px solid ${RULE_SOFT}` }}>
              <div style={{ minWidth: 0 }}>
                <Link href={`/students/${d.studentId}`} className="text-[14px] font-semibold hover:underline" style={{ color: INK }}>
                  {d.studentName}
                </Link>
                <p className="text-[12px]" style={{ color: META, margin: '2px 0 0' }}>
                  {d.className}{d.requestedByName ? ` · requested by ${d.requestedByName}` : ''}
                </p>
              </div>
              <div style={{ minWidth: 0 }}>
                <p className="text-[13px]" style={{ color: BODY, margin: 0 }}>
                  {refundMethodLabel(d.refundMethod)}{d.cycleName ? ` · ${d.cycleName}` : ''}
                </p>
                <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>
                  {refundCategoryLabel(d.category)}{d.refundReference ? ` · ref ${d.refundReference}` : ''}
                </p>
                {d.paystackRefundId && (
                  <p className="text-[12px] m-num" style={{ color: META, margin: '3px 0 0' }}>
                    Paystack ref {d.paystackRefundId}
                  </p>
                )}
                {d.paymentPaidAt && (
                  <p className="text-[12px] m-num" style={{ color: META, margin: '3px 0 0' }}>
                    Payment made {age(d.paymentPaidAt)}
                  </p>
                )}
                <p className="text-[12px] m-num" style={{ color: META, margin: '3px 0 0' }}>
                  {d.autoApproved ? 'Requested' : 'Decided'} {when(d.approvedAt ?? d.requestedAt)}
                </p>
                {d.status === 'rejected' && d.rejectionReason && (
                  <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>&ldquo;{d.rejectionReason}&rdquo;</p>
                )}
                {d.status === 'failed' && d.failureReason && (
                  <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>{d.failureReason}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[14px] font-semibold m-num" style={{ color: amountInk, margin: 0 }}>-{naira(d.amount)}</p>
              </div>
              <div className="text-right">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: d.status === 'completed' ? INK : META }}>
                  {statusLabel}
                </span>
                {d.approvedByName && (
                  <p className="text-[11px]" style={{ color: META, margin: '2px 0 0' }}>{d.approvedByName}</p>
                )}
              </div>
            </div>
          )
        })
      )}
    </Surface>
  )
}

// ---------------------------------------------------------------------------
// Shared table surface — same shape as manual payments' / the discounts queue's.
// ---------------------------------------------------------------------------

function Surface({
  title, body, figure, figureLabel, figureInk, head, children,
}: {
  title: string
  body: string
  figure: string
  figureLabel: string
  figureInk: string
  head: [string, 'left' | 'right'][]
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
          </div>
        )}
      </div>

      <div className={`hidden sm:grid ${COLS_GRID}`} style={{ gap: 14, padding: '0 0 8px', borderBottom: `2px solid ${INK}` }}>
        {head.map((h, i) => (
          <span key={i} className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: META, textAlign: h[1] }}>{h[0]}</span>
        ))}
      </div>

      {children}
    </div>
  )
}
