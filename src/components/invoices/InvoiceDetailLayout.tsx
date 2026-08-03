'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { InvoiceDetail } from '@/lib/queries/fees'
import { formatPaymentMethod } from '@/lib/paymentMethod'
import { sendInvoice } from '@/app/(app)/invoices/[id]/actions'
import { MessageChannel } from '@/lib/messaging/types'
import RequestDiscountModal from '@/components/invoices/RequestDiscountModal'
import Toast from '@/components/ui/Toast'

const CHANNEL_LABELS: Record<MessageChannel, string> = {
  sms: 'SMS',
  email: 'Email',
}

function ChannelIcons() {
  return (
    <span className="flex items-center gap-1 text-navy/60" title="Sends via SMS, with the PDF emailed too when an address is on file">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8-1.436 0-2.795-.29-4.001-.804L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </span>
  )
}

interface Props {
  invoice: InvoiceDetail
}

function formatNaira(amount: number): string {
  return (amount < 0 ? '-₦' : '₦') + Math.abs(amount).toLocaleString('en-NG')
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function statusBadge(invoice: InvoiceDetail) {
  if (invoice.needsResend) return { cls: 'bg-amber-50 text-amber-700', label: 'needs resend' }
  if (invoice.status === 'paid') return { cls: 'bg-mint-light text-mint', label: 'paid' }
  if (invoice.status === 'partial') return { cls: 'bg-amber-50 text-amber-700', label: 'partial' }
  if (invoice.status === 'overdue') return { cls: 'bg-red-50 text-red-700', label: 'overdue' }
  if (invoice.status === 'cancelled') return { cls: 'bg-gray-100 text-gray-500', label: 'cancelled' }
  return { cls: 'bg-gray-100 text-gray-600', label: 'pending' }
}

export default function InvoiceDetailLayout({ invoice }: Props) {
  const router = useRouter()
  const badge = statusBadge(invoice)
  const pdfUrl = `/api/invoices/${invoice.id}/pdf`
  const payments = invoice.payments || []

  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [discountModalOpen, setDiscountModalOpen] = useState(false)
  const [discountSubmitted, setDiscountSubmitted] = useState(false)

  async function handleSend() {
    setSending(true)
    setSendResult(null)
    const r = await sendInvoice(invoice.id)
    setSending(false)
    if (r.error) { setSendResult({ ok: false, message: r.error }); return }
    const channelsUsed = r.channelsUsed || []
    setSendResult({
      ok: true,
      message: `Sent to ${r.to} via ${channelsUsed.length ? channelsUsed.map((c) => CHANNEL_LABELS[c]).join(' + ') : 'unknown channel'}`,
    })
    router.refresh()
  }

  // The primary send button doubles as the resend affordance. If the invoice
  // changed after it was last sent (e.g. a discount was approved), turn it
  // amber so the admin can tell at a glance the parent is holding a stale
  // figure and needs the updated one.
  const sendLabel = invoice.sentAt ? 'Resend to parent' : 'Send to parent'
  const sendBtnClass = invoice.needsResend
    ? 'bg-amber-500 text-white hover:bg-amber-600'
    : 'bg-mint text-navy hover:bg-mint/90'

  return (
    <>
      {/* Header */}
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-3xl font-bold text-navy">Invoice</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
          {badge.label}
        </span>
      </header>

      {/* Row 1: Student / Payment / Invoice details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">

        {/* Student */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Student</p>
          <Link
            href={`/students/${invoice.studentId}`}
            className="text-lg font-semibold text-navy hover:text-mint"
          >
            {invoice.studentFirstName} {invoice.studentLastName}
          </Link>
          <div className="mt-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Admission #</span>
              <span className="text-sm font-medium text-navy">{invoice.studentAdmissionNumber}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Class</span>
              <span className="text-sm font-medium text-navy">{invoice.className}</span>
            </div>
            {invoice.primaryParentName && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Parent / Guardian</span>
                <span className="text-sm font-medium text-navy">{invoice.primaryParentName}</span>
              </div>
            )}
            {invoice.primaryParentPhone && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Phone</span>
                <span className="text-sm font-medium text-navy">{invoice.primaryParentPhone}</span>
              </div>
            )}
          </div>
        </div>

        {/* Payment */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Payment</p>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Total</span>
              <span className="text-sm font-bold text-navy">{formatNaira(invoice.totalAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Paid</span>
              <span className={`text-sm font-semibold ${invoice.paidAmount > 0 ? 'text-mint' : 'text-gray-400'}`}>
                {formatNaira(invoice.paidAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Outstanding</span>
              <span className={`text-sm font-semibold ${invoice.outstandingAmount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {formatNaira(invoice.outstandingAmount)}
              </span>
            </div>
          </div>
        </div>

        {/* Invoice details */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Invoice details</p>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Invoice date</span>
              <span className="text-sm font-medium text-navy">{formatDate(invoice.generatedAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Due date</span>
              <span className="text-sm font-medium text-navy">{formatDate(invoice.cycleDueDate)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Term</span>
              <span className="text-sm font-medium text-navy">{invoice.cycleName}</span>
            </div>
            {invoice.invoiceNumber && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Number</span>
                <span className="text-sm font-medium text-navy">#{invoice.invoiceNumber}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Line items */}
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <h2 className="text-navy font-semibold text-lg mb-4">Line items</h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider pb-2">Item</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider pb-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoice.lineItems.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-3">
                      <span className="text-sm text-navy">{item.name}</span>
                      {item.kind === 'opt_in' && (
                        <span className="ml-2 text-xs text-gray-500">(opt-in)</span>
                      )}
                      {item.kind === 'previous_balance' && (
                        <span className="ml-2 text-xs text-amber-600">(carry-forward)</span>
                      )}
                      {item.kind === 'credit_applied' && (
                        <span className="ml-2 text-xs text-mint">(credit applied)</span>
                      )}
                    </td>
                    <td className="py-3 text-right text-sm text-navy font-medium">
                      {formatNaira(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-100">
                  <td className="pt-3 text-sm text-gray-600">Subtotal</td>
                  <td className="pt-3 text-right text-sm text-navy">{formatNaira(invoice.subtotal)}</td>
                </tr>
                {invoice.discountAmount > 0 && (
                  <tr>
                    <td className="py-1 text-sm text-gray-600">
                      Discount
                      {invoice.discountReason && (
                        <span className="block text-xs text-gray-400 font-normal">{invoice.discountReason}</span>
                      )}
                    </td>
                    <td className="py-1 text-right text-sm text-navy align-top">-{formatNaira(invoice.discountAmount)}</td>
                  </tr>
                )}
                {invoice.previousBalance > 0 && (
                  <tr>
                    <td className="py-1 text-sm text-amber-700">Previous balance carried forward</td>
                    <td className="py-1 text-right text-sm text-amber-700">{formatNaira(invoice.previousBalance)}</td>
                  </tr>
                )}
                <tr className="border-t-2 border-gray-200">
                  <td className="pt-3 text-base font-bold text-navy">Total due</td>
                  <td className="pt-3 text-right text-lg font-bold text-navy">{formatNaira(invoice.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Right: sidebar */}
        <div className="space-y-6">

          {/* Payment instructions */}
          <div className="bg-mint-light/40 border border-mint/30 rounded-xl p-6">
            <p className="text-xs text-mint font-semibold uppercase tracking-wider mb-3">Payment instructions</p>
            {invoice.status === 'paid' ? (
              <div className="bg-white border border-mint/30 rounded-lg py-3 px-3 text-center">
                <p className="text-sm font-semibold text-mint">Paid in full — no further action needed</p>
              </div>
            ) : (
              <>
                {invoice.dvaAccountNumber ? (
                  <>
                    <p className="text-sm text-navy mb-3">
                      Pay directly to the student&apos;s virtual account. Use the admission number as payment reference.
                    </p>
                    <div className="bg-white border border-mint/30 rounded-lg py-3 px-3 text-center">
                      <p className="text-base font-bold text-navy tracking-wide">{invoice.dvaAccountNumber}</p>
                      <p className="text-xs text-gray-500 mt-1">{invoice.dvaBankName}</p>
                    </div>
                  </>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg py-3 px-3 text-center">
                    <p className="text-sm font-semibold text-amber-700">No virtual account yet</p>
                    <p className="text-xs text-amber-600 mt-1">This student needs a virtual account before they can be paid by transfer — create one from the student&apos;s profile to generate their payment details.</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Actions */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Actions</p>

            <button
              onClick={handleSend}
              disabled={sending}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 ${sendBtnClass}`}
              title={invoice.needsResend ? 'The invoice changed since it was last sent — resend to update the parent' : 'Sends via SMS'}
            >
              <span className="flex items-center gap-2">
                <ChannelIcons />
                {sending ? 'Sending…' : sendLabel}
              </span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
            {invoice.needsResend ? (
              <p className="text-xs text-amber-700">Invoice changed since it was last sent — resend to update the parent</p>
            ) : invoice.sentAt ? (
              <p className="text-xs text-gray-500">Last sent {formatDate(invoice.sentAt)}</p>
            ) : (
              <p className="text-xs text-gray-400">Not sent to the parent yet</p>
            )}
            {sendResult && (
              <Toast message={sendResult.message} ok={sendResult.ok} onDismiss={() => setSendResult(null)} />
            )}

            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-navy font-medium hover:bg-gray-50"
            >
              View PDF
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </a>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-navy font-medium hover:bg-gray-50"
            >
              Print invoice
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            </a>

            {invoice.status !== 'cancelled' && (
              invoice.paidAmount > 0 ? (
                <button
                  disabled
                  title="This invoice already has a payment against it — discounts can no longer be applied"
                  className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-400 font-medium opacity-60 cursor-not-allowed"
                >
                  Request discount
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={() => { setDiscountModalOpen(true); setDiscountSubmitted(false) }}
                  className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-navy font-medium hover:bg-gray-50"
                >
                  Request discount
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </button>
              )
            )}
            {discountSubmitted && (
              <p className="text-xs text-mint">Discount request submitted — awaiting admin approval</p>
            )}
          </div>

        </div>
      </div>

      {discountModalOpen && (
        <RequestDiscountModal
          invoiceId={invoice.id}
          onClose={() => setDiscountModalOpen(false)}
          onSuccess={() => {
            setDiscountModalOpen(false)
            setDiscountSubmitted(true)
            router.refresh()
          }}
        />
      )}

      {/* Payment history — full width */}
      <div className="mt-6 bg-white p-6 rounded-xl border border-gray-200">
        <h2 className="text-navy font-semibold text-lg mb-4">Payment history</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            No payments recorded yet.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider pb-2 pr-4">Date</th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider pb-2 pr-4">Method</th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider pb-2 pr-4">Reference</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider pb-2 pr-4">Amount</th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider pb-2">Received by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payments.map(p => (
                <Fragment key={p.id}>
                  <tr>
                    <td className="py-3 pr-4 text-sm text-navy">{formatDate(p.paidAt)}</td>
                    <td className="py-3 pr-4 text-sm text-gray-600">{formatPaymentMethod(p.method)}</td>
                    <td className="py-3 pr-4 text-sm text-gray-600">{p.reference || '—'}</td>
                    <td className="py-3 pr-4 text-right text-sm font-medium text-navy">{formatNaira(p.amount)}</td>
                    <td className="py-3 text-sm text-gray-600">{p.receivedByName || '—'}</td>
                  </tr>
                  {p.otherAllocations && p.otherAllocations.length > 0 && (
                    <tr>
                      <td colSpan={5} className="pb-3 -mt-1">
                        <div className="bg-mint-light/40 border border-mint/20 rounded-lg px-3 py-2 text-xs text-navy">
                          Part of a {formatNaira(p.transactionTotal || p.amount)} transfer — {formatNaira(p.amount)} applied here,{' '}
                          {p.otherAllocations.map((a, i) => (
                            <span key={i}>
                              {a.termName ? `${formatNaira(a.amount)} applied to ${a.termName}` : `${formatNaira(a.amount)} added to credit balance`}
                              {i < p.otherAllocations!.length - 1 ? ', ' : ''}
                            </span>
                          ))}.
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
