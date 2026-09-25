'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { InvoiceDetail } from '@/lib/queries/fees'
import { formatPaymentMethod } from '@/lib/paymentMethod'
import { sendInvoice, sendReceipt, cancelInvoice } from '@/app/(app)/money/invoices/[id]/actions'
import { MessageChannel } from '@/lib/messaging/types'
import RequestDiscountModal from '@/components/invoices/RequestDiscountModal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import Toast from '@/components/ui/Toast'
import { useCan } from '@/lib/auth/PermissionsProvider'
import { useRealtimeRefresh } from '@/lib/realtime/useRealtimeRefresh'
import type { DiscountSettings } from '@/lib/queries/discounts'

const CHANNEL_LABELS: Record<MessageChannel, string> = {
  sms: 'SMS',
  email: 'Email',
}

interface Props {
  invoice: InvoiceDetail
  discountSettings: DiscountSettings
  autoApproveThreshold: number | null
}

// The invoice detail sits on the ink ground (App Shell "showInvoice"): the same
// dark instrument surface as the invoices ledger it's reached from, so money
// stays on one continuous surface. Received reads in lifted ledger green,
// anything awaiting a human in lifted amber; the paper-ground tokens are too
// dark to read here.
const INK = {
  paper: '#f3f2f2',
  dim: '#9b9797',
  faint: '#d7d3d3',
  rule: '#605d5d',
  ruleSoft: '#444141',
  panel: '#2d2b2b',
  green: '#35c483', // --color-ledger, lifted for the ink ground
  amber: '#f0a13c', // ochre, lifted for the ink ground
  signal: '#e8664a', // signal red, lifted for the ink ground
  white: '#ffffff',
}

function formatNaira(amount: number): string {
  return (amount < 0 ? '-₦' : '₦') + Math.abs(amount).toLocaleString('en-NG')
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// The status headline, as colour-carrying text (no pills). Cancelled overrides
// everything — a dead invoice never reads as "needs resend" just because that
// flag happened to be set at cancellation time.
function inkState(invoice: InvoiceDetail): { label: string; color: string; note: string } {
  if (invoice.status === 'cancelled')
    return { label: 'CANCELLED', color: INK.dim, note: 'Voided — excluded from outstanding totals.' }
  if (invoice.needsResend)
    return { label: 'SENT · NOT RESENT', color: INK.amber, note: 'Changed since the last send — the parent still holds the old figure.' }
  if (invoice.status === 'paid')
    return { label: 'SETTLED', color: INK.green, note: 'Paid in full.' }
  if (invoice.status === 'partial')
    return { label: 'PART PAID', color: INK.amber, note: invoice.sentAt ? `Last sent ${formatDate(invoice.sentAt)}.` : 'Not sent to the parent yet.' }
  if (invoice.sentAt)
    return { label: 'SENT', color: INK.faint, note: `Last sent ${formatDate(invoice.sentAt)}.` }
  return { label: 'NOT SENT', color: INK.amber, note: 'Not sent to the parent yet.' }
}

// The outstanding headline's supporting line — paid / due / overdue.
function dueNote(invoice: InvoiceDetail): { text: string; color: string } | null {
  if (invoice.status === 'cancelled') return null
  if (invoice.status === 'paid') return { text: 'Paid in full', color: INK.green }
  if (invoice.cycleDueDate) {
    const due = new Date(invoice.cycleDueDate)
    const days = Math.floor((Date.now() - due.getTime()) / 86_400_000)
    if (days > 0) return { text: `Overdue by ${days} day${days === 1 ? '' : 's'}`, color: INK.amber }
    if (days === 0) return { text: 'Due today', color: INK.amber }
    return { text: `Due ${formatDate(invoice.cycleDueDate)}`, color: INK.faint }
  }
  return null
}

function kindLabel(kind: string | undefined): string {
  if (kind === 'opt_in') return 'OPT-IN'
  if (kind === 'credit_applied') return 'CREDIT'
  return ''
}

// "What happened to this invoice" — the lifecycle, assembled only from signals
// the invoice already carries (no new data layer): generated, discount applied,
// sent/resent, each payment, carried forward, cancelled. Some steps have no
// stored timestamp (a discount edit), shown with an em-dash rather than a
// fabricated time.
interface LogEntry { what: string; time: string; detail: string; color: string }

function buildLog(invoice: InvoiceDetail): LogEntry[] {
  const log: LogEntry[] = []

  log.push({
    what: 'Invoice generated',
    time: formatDate(invoice.generatedAt),
    detail: `${invoice.className} · ${invoice.cycleName}`,
    color: INK.paper,
  })

  if (invoice.discountAmount > 0) {
    log.push({
      what: 'Discount applied',
      time: '—',
      detail: `${formatNaira(invoice.discountAmount)} off${invoice.discountReason ? ` · ${invoice.discountReason}` : ''}`,
      color: INK.paper,
    })
  }

  ;[...(invoice.payments || [])]
    .sort((a, b) => new Date(a.paidAt || 0).getTime() - new Date(b.paidAt || 0).getTime())
    .forEach((p) => {
      const parts = [formatPaymentMethod(p.method), formatNaira(p.amount)]
      if (p.reference) parts.push(`ref ${p.reference}`)
      if (p.receivedByName) parts.push(`received by ${p.receivedByName}`)
      let detail = parts.join(' · ')
      if (p.otherAllocations && p.otherAllocations.length > 0) {
        const alloc = p.otherAllocations
          .map((a) => (a.termName ? `${formatNaira(a.amount)} to ${a.termName}` : `${formatNaira(a.amount)} to credit`))
          .join(', ')
        detail += ` — part of a ${formatNaira(p.transactionTotal || p.amount)} transfer (${alloc})`
      }
      log.push({ what: 'Payment received', time: formatDate(p.paidAt), detail, color: INK.green })
    })

  if (invoice.sentAt) {
    log.push({
      what: invoice.needsResend ? 'Sent — now out of date' : 'Sent to parent',
      time: formatDate(invoice.sentAt),
      detail: invoice.needsResend
        ? 'Changed after this send; the parent holds the old figure.'
        : 'Delivered via SMS / email.',
      color: invoice.needsResend ? INK.amber : INK.paper,
    })
  }

  if (invoice.carriedForwardToCycleName) {
    log.push({
      what: 'Balance carried forward',
      time: '—',
      detail: `Moved to ${invoice.carriedForwardToCycleName}.`,
      color: INK.amber,
    })
  }

  if (invoice.status === 'cancelled') {
    log.push({
      what: 'Invoice cancelled',
      time: '—',
      detail: 'Voided — excluded from outstanding and expected totals from then on.',
      color: INK.dim,
    })
  }

  return log
}

export default function InvoiceDetailLayout({ invoice, discountSettings, autoApproveThreshold }: Props) {
  const router = useRouter()
  useRealtimeRefresh([
    { table: 'invoices', filter: `id=eq.${invoice.id}` },
    { table: 'payments', filter: `invoice_id=eq.${invoice.id}` },
  ])
  const state = inkState(invoice)
  const due = dueNote(invoice)
  const log = buildLog(invoice)
  const pdfUrl = `/api/invoices/${invoice.id}/pdf`

  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [discountModalOpen, setDiscountModalOpen] = useState(false)
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelResult, setCancelResult] = useState<{ ok: boolean; message: string } | null>(null)
  const pendingDiscount = invoice.pendingDiscount
  const canSendInvoice = useCan('manage-invoices')
  const canRequestDiscount = useCan('request-discounts')

  async function handleSend() {
    setSending(true)
    setSendResult(null)
    const r = await sendInvoice(invoice.id)
    setSending(false)
    setSendConfirmOpen(false)
    if ('error' in r) { setSendResult({ ok: false, message: r.error }); return }
    const channelsUsed = r.channelsUsed || []
    setSendResult({
      ok: true,
      message: `Sent to ${r.to} via ${channelsUsed.length ? channelsUsed.map((c: MessageChannel) => CHANNEL_LABELS[c]).join(' + ') : 'unknown channel'}`,
    })
    router.refresh()
  }

  async function handleSendReceipt() {
    setSending(true)
    setSendResult(null)
    const r = await sendReceipt(invoice.id)
    setSending(false)
    setSendConfirmOpen(false)
    if ('error' in r) { setSendResult({ ok: false, message: r.error }); return }
    const channelsUsed = r.channelsUsed || []
    setSendResult({
      ok: true,
      message: `Receipt sent to ${r.to} via ${channelsUsed.length ? channelsUsed.map((c: MessageChannel) => CHANNEL_LABELS[c]).join(' + ') : 'unknown channel'}`,
    })
    router.refresh()
  }

  async function handleCancelInvoice() {
    setCancelling(true)
    const r = await cancelInvoice(invoice.id)
    setCancelling(false)
    if ('error' in r) { setCancelError(r.error); return }
    setCancelConfirmOpen(false)
    setCancelResult({ ok: true, message: 'Invoice cancelled.' })
    router.refresh()
  }

  // An untouched, unpaid invoice can be cancelled outright — e.g. a stray
  // term invoice left over after a student was withdrawn. Anything with a
  // payment or credit already applied needs a refund/credit decision first,
  // so it's not offered here (cancelInvoice enforces the same rule server-side).
  const canCancelInvoice = canSendInvoice && invoice.status !== 'cancelled' && invoice.status !== 'paid'
    && invoice.paidAmount <= 0 && invoice.creditApplied <= 0

  // A fully-paid invoice has nothing due, so "send the invoice" would read as
  // a NGN0 bill — send a payment receipt instead. Balance-remaining invoices
  // keep the normal invoice send.
  const isFullyPaid = invoice.status === 'paid'
  const sendLabel = isFullyPaid ? 'Send receipt' : invoice.sentAt ? 'Resend to parent' : 'Send to parent'

  const lineItems = invoice.lineItems.filter((item) => item.kind !== 'previous_balance')

  return (
    <>
      <div
        style={{ background: 'var(--color-ink)', color: INK.paper }}
        className="px-5 sm:px-7 py-7 m-anim-fade"
      >
      {/* Header — identity / outstanding / state / actions */}
      <div
        className="grid gap-6 items-start pt-5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', borderTop: `2px solid ${INK.paper}` }}
      >
        {/* Identity */}
        <div>
          <p className="text-[11px] tracking-[0.16em] mb-2 m-num" style={{ color: INK.dim }}>
            {invoice.invoiceNumber ? `#${invoice.invoiceNumber} · ` : ''}{invoice.cycleName.toUpperCase()}
          </p>
          <Link
            href={`/students/${invoice.studentId}`}
            className="block text-[28px] font-extrabold leading-none tracking-[-0.02em] hover:underline"
            style={{ color: INK.white }}
          >
            {invoice.studentFirstName} {invoice.studentLastName}
          </Link>
          <p className="text-[14px] mt-1.5 m-num" style={{ color: INK.faint }}>
            {invoice.className} · {invoice.studentAdmissionNumber}
          </p>
        </div>

        {/* Outstanding */}
        <div>
          <p className="text-[11px] tracking-[0.16em] mb-2" style={{ color: INK.dim }}>OUTSTANDING</p>
          {invoice.status === 'cancelled' ? (
            <p className="text-[34px] font-extrabold leading-[0.95] tracking-[-0.03em]" style={{ color: INK.dim }}>Cancelled</p>
          ) : (
            <p className="m-num text-[34px] font-extrabold leading-[0.95] tracking-[-0.03em]" style={{ color: INK.white }}>
              {formatNaira(invoice.outstandingAmount)}
            </p>
          )}
          {due && (
            <p className="text-[13px] font-semibold mt-1" style={{ color: due.color }}>{due.text}</p>
          )}
        </div>

        {/* State */}
        <div>
          <p className="text-[11px] tracking-[0.16em] mb-2" style={{ color: INK.dim }}>STATE</p>
          <p className="text-[14px] font-semibold tracking-[0.06em] mb-1.5" style={{ color: state.color }}>{state.label}</p>
          <p className="text-[13px]" style={{ color: INK.faint }}>{state.note}</p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {canSendInvoice && invoice.status !== 'cancelled' && !invoice.carriedForwardToCycleName && (
            <button
              onClick={() => setSendConfirmOpen(true)}
              disabled={sending}
              className="m-btn m-btn-ink-primary w-full justify-start"
              title={isFullyPaid ? 'Sends a payment receipt via SMS/email' : invoice.needsResend ? 'The invoice changed since it was last sent — resend to update the parent' : 'Sends via SMS'}
            >
              {sending ? 'Sending...' : sendLabel}
            </button>
          )}

          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="m-btn m-btn-ink w-full justify-start">
            View PDF
          </a>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="m-btn m-btn-ink w-full justify-start">
            Print invoice
          </a>

          {canRequestDiscount && invoice.status !== 'cancelled' && (
            pendingDiscount ? (
              <button disabled title="A discount request is already pending on this invoice" className="m-btn m-btn-ink w-full justify-start">
                Discount pending
              </button>
            ) : invoice.carriedForwardToCycleName ? (
              <button disabled title={`This balance carried forward to ${invoice.carriedForwardToCycleName} — request the discount there instead`} className="m-btn m-btn-ink w-full justify-start">
                Request discount
              </button>
            ) : invoice.paidAmount > 0 ? (
              <button disabled title="This invoice already has a payment against it — discounts can no longer be applied" className="m-btn m-btn-ink w-full justify-start">
                Request discount
              </button>
            ) : (
              <button onClick={() => setDiscountModalOpen(true)} className="m-btn m-btn-ink w-full justify-start">
                Request discount
              </button>
            )
          )}

          {canCancelInvoice && (
            <button onClick={() => { setCancelError(null); setCancelConfirmOpen(true) }} className="m-btn m-btn-ink-danger w-full justify-start">
              Cancel invoice
            </button>
          )}

          {invoice.carriedForwardToCycleName && (
            <p className="text-[12px]" style={{ color: INK.dim }}>
              This balance carried forward to <span style={{ color: INK.paper }}>{invoice.carriedForwardToCycleName}</span> automatically — send that invoice instead.
            </p>
          )}
          {pendingDiscount && (
            <p className="text-[12px]" style={{ color: INK.amber }}>
              Discount requested{pendingDiscount.requestedByName ? ` by ${pendingDiscount.requestedByName}` : ''} on {formatDate(pendingDiscount.requestedAt)} — awaiting admin approval
            </p>
          )}
          {sendResult && (
            <Toast message={sendResult.message} ok={sendResult.ok} onDismiss={() => setSendResult(null)} />
          )}
          {cancelResult && (
            <Toast message={cancelResult.message} ok={cancelResult.ok} onDismiss={() => setCancelResult(null)} />
          )}
        </div>
      </div>

      {invoice.studentCreditBalance > 0 && (
        <div className="mt-6 pl-3" style={{ borderLeft: `3px solid ${INK.green}` }}>
          <p className="text-[13px]" style={{ color: INK.faint }}>
            <span className="font-semibold m-num" style={{ color: INK.paper }}>{formatNaira(invoice.studentCreditBalance)}</span> of this student&apos;s credit balance is unapplied — it will be used automatically the next time an invoice is generated or updated.
          </p>
        </div>
      )}

      {/* Body — line items / lifecycle */}
      <div
        className="grid gap-10 mt-8"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}
      >
        {/* Line items */}
        <div>
          <h3 className="text-[18px] font-extrabold mb-3.5" style={{ color: INK.white }}>Line items</h3>

          {lineItems.map((item, idx) => (
            <div
              key={idx}
              className="grid gap-3 items-baseline py-2.5"
              style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto', borderTop: `1px solid ${INK.ruleSoft}` }}
            >
              <span className="text-[14px]" style={{ color: item.kind === 'credit_applied' ? INK.green : INK.paper }}>{item.name}</span>
              <span className="text-[11px] font-semibold tracking-[0.1em] text-right" style={{ color: INK.dim, minWidth: 84 }}>{kindLabel(item.kind)}</span>
              <span className="text-[14px] m-num text-right" style={{ color: item.kind === 'credit_applied' ? INK.green : INK.paper, minWidth: 92 }}>{formatNaira(item.amount)}</span>
            </div>
          ))}

          {(invoice.discountAmount > 0 || invoice.previousBalance > 0 || invoice.creditApplied > 0) && (
            <div className="grid gap-3 py-2.5" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', borderTop: `1px solid ${INK.ruleSoft}` }}>
              <span className="text-[14px]" style={{ color: INK.faint }}>Subtotal</span>
              <span className="text-[14px] m-num text-right" style={{ color: INK.faint }}>{formatNaira(invoice.subtotal)}</span>
            </div>
          )}
          {invoice.discountAmount > 0 && (
            <div className="grid gap-3 py-2.5" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', borderTop: `1px solid ${INK.ruleSoft}` }}>
              <span className="text-[14px]" style={{ color: INK.faint }}>
                Discount
                {invoice.discountReason && <span className="block text-[12px]" style={{ color: INK.dim }}>{invoice.discountReason}</span>}
              </span>
              <span className="text-[14px] m-num text-right" style={{ color: INK.faint }}>-{formatNaira(invoice.discountAmount)}</span>
            </div>
          )}
          {invoice.previousBalance > 0 && (
            <div className="grid gap-3 py-2.5" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', borderTop: `1px solid ${INK.ruleSoft}` }}>
              <span className="text-[14px]" style={{ color: INK.amber }}>Previous balance carried forward</span>
              <span className="text-[14px] m-num text-right" style={{ color: INK.amber }}>{formatNaira(invoice.previousBalance)}</span>
            </div>
          )}

          <div className="grid gap-3 py-3" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', borderTop: `2px solid ${INK.paper}` }}>
            <span className="text-[14px] font-extrabold" style={{ color: INK.white }}>Total billed</span>
            <span className="text-[16px] font-extrabold m-num text-right" style={{ color: INK.white }}>{formatNaira(invoice.totalAmount)}</span>
          </div>
          <div className="grid gap-3 py-2.5" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', borderTop: `1px solid ${INK.ruleSoft}` }}>
            <span className="text-[14px]" style={{ color: INK.faint }}>Paid</span>
            <span className="text-[14px] font-semibold m-num text-right" style={{ color: invoice.paidAmount > 0 ? INK.green : INK.dim }}>
              {invoice.paidAmount > 0 ? `− ${formatNaira(invoice.paidAmount)}` : formatNaira(0)}
            </span>
          </div>
          <div className="grid gap-3 pt-3" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', borderTop: `1px solid ${INK.ruleSoft}` }}>
            <span className="text-[15px] font-extrabold" style={{ color: INK.white }}>Outstanding</span>
            <span className="text-[20px] font-extrabold m-num text-right" style={{ color: invoice.status === 'cancelled' ? INK.dim : INK.white }}>
              {invoice.status === 'cancelled' ? '—' : formatNaira(invoice.outstandingAmount)}
            </span>
          </div>
        </div>

        {/* Lifecycle */}
        <div>
          <h3 className="text-[18px] font-extrabold mb-1" style={{ color: INK.white }}>What happened to this invoice</h3>
          <p className="text-[13px] mb-3.5" style={{ color: INK.dim }}>
            Generated, changed, sent and paid — in one column, so a parent query is answerable without leaving the page.
          </p>

          {log.map((l, idx) => (
            <div key={idx} className="py-2.5" style={{ borderTop: `1px solid ${INK.ruleSoft}` }}>
              <div className="flex justify-between gap-2.5 items-baseline">
                <p className="text-[13px] font-semibold" style={{ color: l.color }}>{l.what}</p>
                <p className="text-[12px] m-num flex-shrink-0" style={{ color: INK.dim }}>{l.time}</p>
              </div>
              <p className="text-[12px] mt-0.5 m-num" style={{ color: INK.dim }}>{l.detail}</p>
            </div>
          ))}

          {/* Parent pays into */}
          <div className="mt-5 pt-3.5" style={{ borderTop: `2px solid ${INK.rule}` }}>
            {invoice.status === 'cancelled' ? (
              <p className="text-[13px]" style={{ color: INK.dim }}>Cancelled — no payment due.</p>
            ) : invoice.status === 'paid' ? (
              <p className="text-[13px] font-semibold" style={{ color: INK.green }}>Paid in full — no further action needed.</p>
            ) : invoice.dvaAccountNumber ? (
              <>
                <p className="text-[11px] tracking-[0.14em] mb-2" style={{ color: INK.dim }}>PARENT PAYS INTO</p>
                <p className="text-[20px] font-extrabold tracking-[0.02em] m-num" style={{ color: INK.white }}>{invoice.dvaAccountNumber}</p>
                <p className="text-[13px] mt-1" style={{ color: INK.faint }}>
                  {invoice.dvaBankName}
                  {invoice.primaryParentName ? ` · ${invoice.primaryParentName}` : ''}
                  {invoice.primaryParentPhone ? ` · ${invoice.primaryParentPhone}` : ''}
                </p>
                <p className="text-[12px] mt-2" style={{ color: INK.dim }}>Use the admission number as the payment reference.</p>
              </>
            ) : (
              <div className="pl-3" style={{ borderLeft: `3px solid ${INK.signal}` }}>
                <p className="text-[13px] font-semibold" style={{ color: INK.signal }}>No virtual account yet</p>
                <p className="text-[12px] mt-1" style={{ color: INK.dim }}>This student needs a virtual account before they can be paid by transfer — create one from the student&apos;s profile to generate their payment details.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {cancelConfirmOpen && (
        <DestructiveConfirmModal
          eyebrow="This cannot be undone from here"
          title={`Cancel this invoice for ${invoice.studentFirstName} ${invoice.studentLastName}?`}
          description="Voids the invoice. Use this when the student won't be paying it — e.g. withdrawn — not for a billing mistake on an invoice that's still owed."
          rows={[
            { label: 'Invoice amount', value: formatNaira(invoice.totalAmount) },
            { label: 'After cancelling', value: 'Excluded from outstanding & expected totals', valueClassName: 'text-sm font-semibold text-[var(--color-signal-text)]', emphasize: true },
          ]}
          error={cancelError}
          actions={[
            { label: 'Keep invoice', onClick: () => setCancelConfirmOpen(false), variant: 'outline', disabled: cancelling },
            { label: cancelling ? 'Cancelling...' : 'Cancel invoice', onClick: handleCancelInvoice, variant: 'danger', disabled: cancelling },
          ]}
        />
      )}

      {discountModalOpen && (
        <RequestDiscountModal
          invoiceId={invoice.id}
          subtotal={invoice.subtotal}
          existingDiscountAmount={invoice.discountAmount}
          discountSettings={discountSettings}
          autoApproveThreshold={autoApproveThreshold}
          onClose={() => setDiscountModalOpen(false)}
          onSuccess={(autoApproved) => {
            setDiscountModalOpen(false)
            setSendResult({
              ok: true,
              message: autoApproved ? 'Discount granted — below the auto-approve threshold.' : 'Discount request submitted — awaiting admin approval.',
            })
            router.refresh()
          }}
        />
      )}

      {sendConfirmOpen && (
        <ConfirmDialog
          title={isFullyPaid ? 'Send this receipt to the parent now?' : `${invoice.sentAt ? 'Resend' : 'Send'} this invoice to the parent now?`}
          message={
            isFullyPaid
              ? `Sends a payment receipt to ${invoice.primaryParentName || 'the parent'} for ${invoice.studentFirstName} ${invoice.studentLastName}.`
              : `Sends the current invoice (${formatNaira(invoice.totalAmount)} due) to ${invoice.primaryParentName || 'the parent'} for ${invoice.studentFirstName} ${invoice.studentLastName}.`
          }
          confirmLabel={isFullyPaid ? 'Send receipt' : invoice.sentAt ? 'Resend' : 'Send'}
          onConfirm={isFullyPaid ? handleSendReceipt : handleSend}
          onCancel={() => setSendConfirmOpen(false)}
        />
      )}
    </div>
    </>
  )
}
