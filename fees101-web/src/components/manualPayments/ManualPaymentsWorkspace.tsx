'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePermissions } from '@/lib/auth/PermissionsProvider'
import Toast from '@/components/ui/Toast'
import {
  manualPaymentMethodLabel,
  manualPaymentDepositLabel,
  type PendingManualPayment,
  type DecidedManualPayment,
} from '@/lib/manualPayments/display'
import {
  requestManualPayment,
  approveManualPayment,
  rejectManualPayment,
  requestReversal,
  searchManualPaymentStudents,
  getStudentOpenInvoices,
  type ManualPaymentStudentOption,
  type ManualPaymentInvoiceOption,
} from '@/app/(app)/discounts/manual-payments/actions'

const INK = 'var(--color-ink)'
const BODY = 'var(--color-neutral-800)'
const META = 'var(--color-neutral-700)'
const DIM = 'var(--color-neutral-500)'
const OCHRE = 'var(--color-ochre-text)'
const LEDGER = 'var(--color-ledger)'
const SIGNAL = 'var(--color-signal-text)'
const RULE_SOFT = 'var(--color-neutral-300)'

// Four columns on desktop; collapses to a single stacked column below the sm
// breakpoint so the DETAIL column stops crushing at phone width.
const COLS_GRID = 'sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]'

// Focus ring for bare text-buttons, matching .m-btn's signal-red outline.
const FOCUS = 'focus-visible:outline-none focus-visible:[outline:2px_solid_var(--color-signal)] focus-visible:[outline-offset:2px]'

const METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'pos', label: 'POS / card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
]
const DEPOSIT_OPTIONS = [
  { value: 'school_bank', label: "School's bank account" },
  { value: 'paystack_dva', label: 'Fees101 transfer account' },
  { value: 'other', label: 'Other' },
]

function naira(n: number): string {
  return `₦${Math.round(Math.abs(n)).toLocaleString('en-NG')}`
}

// Short, readable date + time, for "how long has this waited" and "when was
// this decided". Tabular figures via m-num at the call site.
function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

type Tab = 'record' | 'pending' | 'history'

interface Props {
  pending: PendingManualPayment[]
  decided: DecidedManualPayment[]
  canRecord: boolean
  canApprove: boolean
}

export default function ManualPaymentsWorkspace({ pending, decided, canRecord, canApprove }: Props) {
  const router = useRouter()
  const { isOwner } = usePermissions()
  // Staff who can record but not approve land on Record; approvers land on
  // Pending, since their job here is deciding what others recorded.
  const [tab, setTab] = useState<Tab>(canApprove ? 'pending' : 'record')
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)

  const tabs: { key: Tab; label: React.ReactNode; show: boolean }[] = [
    { key: 'record', label: 'Record', show: canRecord },
    {
      key: 'pending',
      label: <>Pending{pending.length > 0 && <span className="m-num"> ({pending.length})</span>}</>,
      show: true,
    },
    { key: 'history', label: 'History', show: true },
  ]

  return (
    <div className="px-4 sm:px-7 py-7">
      {/* Single tab bar, in the .m-tab vocabulary (signal-red active underline)
          so it matches the header's own mode tabs instead of competing with a
          second indicator colour. The page header's route-mode tabs are
          suppressed (showTabs={false}) so this is the only tab bar. */}
      <div className="flex flex-wrap items-center gap-6" style={{ borderBottom: `1px solid ${RULE_SOFT}`, marginBottom: 20 }}>
        {tabs.filter(t => t.show).map(t => (
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

      {tab === 'record' && canRecord && (
        <RecordForm onDone={(msg) => { setToast({ ok: true, message: msg }); setTab(isOwner ? 'history' : 'pending'); router.refresh() }} onError={(msg) => setToast({ ok: false, message: msg })} />
      )}

      {tab === 'pending' && (
        <PendingList
          pending={pending}
          canApprove={canApprove}
          onResult={(ok, message) => { setToast({ ok, message }); if (ok) router.refresh() }}
        />
      )}

      {tab === 'history' && (
        <HistoryList
          decided={decided}
          canApprove={canApprove}
          onResult={(ok, message) => { setToast({ ok, message }); if (ok) router.refresh() }}
        />
      )}

      {toast && <Toast message={toast.message} ok={toast.ok} onDismiss={() => setToast(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Record form
// ---------------------------------------------------------------------------

function RecordForm({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ManualPaymentStudentOption[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [student, setStudent] = useState<ManualPaymentStudentOption | null>(null)

  const [invoices, setInvoices] = useState<ManualPaymentInvoiceOption[]>([])
  const [invoiceId, setInvoiceId] = useState('') // '' means credit balance
  const [invLoading, setInvLoading] = useState(false)

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [depositedTo, setDepositedTo] = useState('school_bank')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchSeq = useRef(0)

  // Debounced student search.
  useEffect(() => {
    if (student) return
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    const seq = ++searchSeq.current
    setSearching(true)
    const handle = setTimeout(async () => {
      const r = await searchManualPaymentStudents(q)
      if (seq === searchSeq.current) { setResults(r); setSearching(false); setShowResults(true) }
    }, 250)
    return () => clearTimeout(handle)
  }, [query, student])

  async function pickStudent(s: ManualPaymentStudentOption) {
    setStudent(s)
    setShowResults(false)
    setQuery(s.name)
    setInvoiceId('')
    setInvLoading(true)
    const open = await getStudentOpenInvoices(s.id)
    setInvoices(open)
    setInvLoading(false)
  }

  function clearStudent() {
    setStudent(null)
    setQuery('')
    setResults([])
    setInvoices([])
    setInvoiceId('')
    setInvLoading(false)
  }

  async function submit() {
    setError(null)
    if (!student) { setError('Choose a student first.'); return }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than zero.'); return }

    setBusy(true)
    const r = await requestManualPayment({
      studentId: student.id,
      invoiceId: invoiceId || null,
      amount: amt,
      method,
      depositedTo,
      depositReference: reference,
      notes,
    })
    setBusy(false)
    if ('error' in r) { setError(r.error); onError(r.error); return }
    // Reset for the next entry.
    clearStudent()
    setAmount(''); setMethod('cash'); setDepositedTo('school_bank'); setReference(''); setNotes('')
    onDone('Payment recorded.')
  }

  return (
    <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 18, maxWidth: '72ch' }}>
      <h2 className="text-[25px] font-extrabold tracking-[-0.015em]" style={{ color: INK, margin: '0 0 4px' }}>
        Record a payment
      </h2>
      <p className="text-[14px]" style={{ color: BODY, margin: '0 0 20px', maxWidth: '64ch' }}>
        For a cash, POS or cheque payment that did not come through the automatic transfer account. It applies to the
        account as soon as you record it; a payment recorded by another staff member waits for an approver first.
      </p>

      {/* Student picker */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <label htmlFor="mp-student" className="m-label">Student</label>
        {student ? (
          <div className="flex items-center justify-between gap-3" style={{ border: `1px solid ${RULE_SOFT}`, padding: '10px 12px' }}>
            <span className="text-[14px] font-semibold" style={{ color: INK }}>
              {student.name}{student.className ? ` · ${student.className}` : ''}
            </span>
            <button onClick={clearStudent} className={`text-[12px] font-semibold uppercase tracking-[0.08em] hover:underline ${FOCUS}`} style={{ color: INK }}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              id="mp-student"
              className="m-input"
              value={query}
              onChange={e => { setQuery(e.target.value); setShowResults(true) }}
              onFocus={() => setShowResults(true)}
              placeholder="Search by name"
              autoComplete="off"
            />
            {showResults && query.trim().length >= 2 && (
              <div style={{ border: `1px solid ${RULE_SOFT}`, borderTop: 'none', maxHeight: 240, overflowY: 'auto' }}>
                {searching && results.length === 0 ? (
                  <p className="text-[13px]" style={{ color: META, padding: '10px 12px' }}>Searching...</p>
                ) : results.length === 0 ? (
                  <p className="text-[13px]" style={{ color: META, padding: '10px 12px' }}>No students match that.</p>
                ) : (
                  results.map(s => (
                    <button
                      key={s.id}
                      onClick={() => pickStudent(s)}
                      className={`block w-full text-left text-[14px] hover:underline ${FOCUS}`}
                      style={{ color: INK, padding: '9px 12px', borderBottom: `1px solid ${RULE_SOFT}` }}
                    >
                      {s.name}{s.className ? <span style={{ color: META }}> · {s.className}</span> : null}
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Invoice (optional) */}
      {student && (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="mp-invoice" className="m-label">Apply to</label>
          <select id="mp-invoice" className="m-select" value={invoiceId} onChange={e => setInvoiceId(e.target.value)}>
            <option value="">Student&apos;s account balance (no specific invoice)</option>
            {invoices.map(inv => (
              <option key={inv.id} value={inv.id}>
                {inv.cycleName} — {naira(inv.outstanding)} outstanding
              </option>
            ))}
          </select>
          {!invLoading && invoices.length === 0 && (
            <p className="text-[12px]" style={{ color: META, margin: '6px 0 0' }}>
              No open invoices for this student. The payment goes onto their account balance.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 16 }}>
        <div>
          <label htmlFor="mp-amount" className="m-label">Amount (₦)</label>
          <input
            id="mp-amount"
            className="m-input m-num"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="0"
          />
        </div>
        <div>
          <label htmlFor="mp-method" className="m-label">How it was paid</label>
          <select id="mp-method" className="m-select" value={method} onChange={e => setMethod(e.target.value)}>
            {METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mp-deposit" className="m-label">Where it was deposited</label>
          <select id="mp-deposit" className="m-select" value={depositedTo} onChange={e => setDepositedTo(e.target.value)}>
            {DEPOSIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mp-reference" className="m-label">Reference (optional)</label>
          <input id="mp-reference" className="m-input" value={reference} onChange={e => setReference(e.target.value)} placeholder="Teller, POS or cheque number" />
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label htmlFor="mp-notes" className="m-label">Note (optional)</label>
        <textarea id="mp-notes" className="m-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth recording about this payment" />
      </div>

      {error && (
        <div className="pl-3 text-sm" style={{ borderLeft: `3px solid ${SIGNAL}`, color: SIGNAL, marginBottom: 14 }}>
          {error}
        </div>
      )}

      <button onClick={submit} disabled={busy || !student} className="m-btn m-btn-primary">
        {busy ? 'Recording...' : 'Record payment'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pending list
// ---------------------------------------------------------------------------

function PendingList({
  pending, canApprove, onResult,
}: {
  pending: PendingManualPayment[]
  canApprove: boolean
  onResult: (ok: boolean, message: string) => void
}) {
  const [open, setOpen] = useState<{ id: string; stage: 'decide' | 'reject' } | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const total = useMemo(
    () => pending.filter(p => !p.isReversal).reduce((s, p) => s + p.amount, 0),
    [pending],
  )

  async function approve(id: string) {
    setError(null); setBusyId(id)
    const r = await approveManualPayment(id)
    setBusyId(null)
    if ('error' in r) { setError(r.error); onResult(false, r.error); return }
    setOpen(null)
    onResult(true, 'Payment approved.')
  }

  async function reject(id: string) {
    setError(null); setBusyId(id)
    const r = await rejectManualPayment(id, rejectNote)
    setBusyId(null)
    if ('error' in r) { setError(r.error); onResult(false, r.error); return }
    setOpen(null); setRejectNote('')
    onResult(true, 'Request rejected.')
  }

  return (
    <Surface
      title="Waiting for a decision"
      body={canApprove
        ? 'Payments other staff have recorded, oldest first. Approving applies the money to the account and sends the parent a receipt.'
        : 'Payments waiting for someone with approval rights to sign off. You recorded these; they apply once approved.'}
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
          // Pending money has not arrived yet: it is awaiting a human, so ochre,
          // never ledger green (which is reserved for money that actually landed).
          const amountInk = OCHRE
          return (
            <Fragment key={p.id}>
              <div className={`grid grid-cols-1 ${COLS_GRID} items-baseline`} style={{ gap: 14, padding: '12px 0', borderBottom: `1px solid ${RULE_SOFT}` }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/students/${p.studentId}`} className="text-[14px] font-semibold hover:underline" style={{ color: INK }}>
                    {p.studentName}
                  </Link>
                  <p className="text-[12px]" style={{ color: META, margin: '2px 0 0' }}>
                    {p.className}{p.requestedByName ? ` · recorded by ${p.requestedByName}` : ''}
                  </p>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="text-[13px]" style={{ color: BODY, margin: 0 }}>
                    {p.isReversal ? 'Reversal of a recorded payment' : manualPaymentMethodLabel(p.method)}
                    {p.cycleName ? ` · ${p.cycleName}` : ' · account balance'}
                  </p>
                  <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>
                    {manualPaymentDepositLabel(p.depositedTo)}{p.depositReference ? ` · ref ${p.depositReference}` : ''}
                  </p>
                  <p className="text-[12px] m-num" style={{ color: META, margin: '3px 0 0' }}>
                    Recorded {when(p.requestedAt)}
                  </p>
                  {p.notes && <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>&ldquo;{p.notes}&rdquo;</p>}
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold m-num" style={{ color: amountInk, margin: 0 }}>
                    {p.isReversal ? `-${naira(p.amount)}` : naira(p.amount)}
                  </p>
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
                        {p.isReversal
                          ? `Approving this reverses ${naira(p.amount)} off ${p.studentName}'s account and sends the parent a correction.`
                          : `Approving applies ${naira(p.amount)} to ${p.studentName}'s ${p.cycleName ? `${p.cycleName} invoice` : 'account balance'} and sends the parent a receipt.`}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => approve(p.id)} disabled={busyId === p.id} className="m-btn m-btn-primary m-btn-sm">
                          {busyId === p.id ? 'Approving...' : p.isReversal ? 'Approve reversal' : 'Approve'}
                        </button>
                        <button onClick={() => setOpen({ id: p.id, stage: 'reject' })} disabled={busyId === p.id} className={`text-[13px] font-semibold hover:underline disabled:opacity-40 disabled:no-underline ${FOCUS}`} style={{ color: INK }}>
                          Reject
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label htmlFor="mp-reject-note" className="m-label">Reason for rejection (the person who recorded it sees this)</label>
                      <textarea id="mp-reject-note" value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2} className="m-textarea mb-3" style={{ maxWidth: 520 }} autoFocus />
                      <div className="flex items-center gap-2">
                        <button onClick={() => reject(p.id)} disabled={busyId === p.id} className="m-btn m-btn-danger m-btn-sm">
                          {busyId === p.id ? 'Rejecting...' : 'Reject request'}
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

function HistoryList({
  decided, canApprove, onResult,
}: {
  decided: DecidedManualPayment[]
  canApprove: boolean
  onResult: (ok: boolean, message: string) => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reverse(id: string) {
    setError(null); setBusyId(id)
    const r = await requestReversal(id, reason)
    setBusyId(null)
    if ('error' in r) { setError(r.error); onResult(false, r.error); return }
    setConfirmId(null); setReason('')
    onResult(true, 'Reversal raised for approval.')
  }

  return (
    <Surface
      title="Recorded payments"
      body="Every manual payment that has been decided, newest first. Reversing an approved payment raises a correction for an approver to sign off."
      figure=""
      figureLabel=""
      figureInk={INK}
      head={[['STUDENT', 'left'], ['DETAIL', 'left'], ['AMOUNT', 'right'], ['', 'right']]}
    >
      {decided.length === 0 ? (
        <p className="text-sm py-4" style={{ color: META }}>Nothing recorded yet.</p>
      ) : (
        decided.map(d => {
          const confirming = confirmId === d.id
          const rejected = d.status === 'rejected'
          // Ledger green only for money that arrived and is still live. A
          // rejected request is inert (dim); a reversal entry and a payment that
          // was later clawed back no longer represent live collected money.
          const amountInk = rejected ? DIM : d.isReversal ? OCHRE : d.reversed ? DIM : LEDGER
          // A completed, still-active approved payment (not a reversal, not
          // already reversed) is the only thing that can be reversed.
          const canReverse = canApprove && d.status === 'approved' && !d.isReversal && !d.reversed
          const statusLabel = rejected
            ? 'Rejected'
            : d.isReversal ? 'Reversed' : d.reversed ? 'Reversed later' : d.autoApproved ? 'Recorded' : 'Approved'
          return (
            <Fragment key={d.id}>
              <div className={`grid grid-cols-1 ${COLS_GRID} items-baseline`} style={{ gap: 14, padding: '12px 0', borderBottom: `1px solid ${RULE_SOFT}` }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/students/${d.studentId}`} className="text-[14px] font-semibold hover:underline" style={{ color: INK }}>
                    {d.studentName}
                  </Link>
                  <p className="text-[12px]" style={{ color: META, margin: '2px 0 0' }}>
                    {d.className}{d.requestedByName ? ` · recorded by ${d.requestedByName}` : ''}
                  </p>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="text-[13px]" style={{ color: BODY, margin: 0 }}>
                    {d.isReversal ? 'Reversal of a recorded payment' : manualPaymentMethodLabel(d.method)}
                    {d.cycleName ? ` · ${d.cycleName}` : ' · account balance'}
                  </p>
                  <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>
                    {manualPaymentDepositLabel(d.depositedTo)}{d.depositReference ? ` · ref ${d.depositReference}` : ''}
                  </p>
                  <p className="text-[12px] m-num" style={{ color: META, margin: '3px 0 0' }}>
                    {d.autoApproved ? 'Recorded' : 'Decided'} {when(d.reviewedAt ?? d.requestedAt)}
                  </p>
                  {rejected && d.reviewNote && (
                    <p className="text-[12px]" style={{ color: META, margin: '3px 0 0' }}>&ldquo;{d.reviewNote}&rdquo;</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold m-num" style={{ color: amountInk, margin: 0 }}>
                    {d.isReversal ? `-${naira(d.amount)}` : naira(d.amount)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: rejected ? META : INK }}>
                    {statusLabel}
                  </span>
                  {canReverse && !confirming && (
                    <p style={{ margin: '4px 0 0' }}>
                      <button onClick={() => { setError(null); setReason(''); setConfirmId(d.id) }} className={`text-[11px] font-semibold uppercase tracking-[0.06em] hover:underline ${FOCUS}`} style={{ color: SIGNAL }}>
                        Reverse?
                      </button>
                    </p>
                  )}
                  {d.reviewedByName && (
                    <p className="text-[11px]" style={{ color: META, margin: '2px 0 0' }}>{d.reviewedByName}</p>
                  )}
                </div>
              </div>

              {confirming && (
                <div style={{ borderBottom: `1px solid ${RULE_SOFT}`, borderLeft: `2px solid ${INK}`, padding: '16px 0 18px 16px' }}>
                  <p className="text-sm mb-3" style={{ color: INK, maxWidth: '64ch' }}>
                    This raises a reversal of {naira(d.amount)} for {d.studentName}. It takes the money back off the
                    account once an approver signs off, and the parent is sent a correction. Say why.
                  </p>
                  <label htmlFor="mp-reversal-reason" className="m-label">Reason for the reversal</label>
                  <textarea id="mp-reversal-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2} className="m-textarea mb-3" style={{ maxWidth: 520 }} autoFocus />
                  <div className="flex items-center gap-2">
                    <button onClick={() => reverse(d.id)} disabled={busyId === d.id} className="m-btn m-btn-danger m-btn-sm">
                      {busyId === d.id ? 'Raising...' : 'Raise reversal'}
                    </button>
                    <button onClick={() => setConfirmId(null)} disabled={busyId === d.id} className={`text-[13px] font-semibold hover:underline disabled:opacity-40 disabled:no-underline ${FOCUS}`} style={{ color: INK }}>
                      Cancel
                    </button>
                  </div>
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
// Shared table surface — same shape as the Discounts queue's.
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
