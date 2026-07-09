'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { InvoiceDetail } from '@/lib/queries/fees'
import { formatPaymentMethod } from '@/lib/paymentMethod'

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
  const badge = statusBadge(invoice)
  const pdfUrl = `/api/invoices/${invoice.id}/pdf`
  const payments = invoice.payments || []

  return (
    <>
      {/* Header */}
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-3xl font-bold text-navy">Invoice</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
          {badge.label}
        </span>
      </header>

      {invoice.needsResend && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-navy">This invoice needs to be resent</p>
            <p className="text-xs text-gray-600 mt-0.5">
              The invoice was updated after being sent to parents. Download the latest PDF and resend to the parent.
            </p>
          </div>
        </div>
      )}

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
                    <td className="py-1 text-sm text-gray-600">Discount</td>
                    <td className="py-1 text-right text-sm text-navy">-{formatNaira(invoice.discountAmount)}</td>
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
                <p className="text-sm text-navy mb-3">
                  Pay directly to the student&apos;s virtual account. Use the admission number as payment reference.
                </p>
                {invoice.dvaAccountNumber ? (
                  <div className="bg-white border border-mint/30 rounded-lg py-3 px-3 text-center">
                    <p className="text-base font-bold text-navy tracking-wide">{invoice.dvaAccountNumber}</p>
                    <p className="text-xs text-gray-500 mt-1">{invoice.dvaBankName}</p>
                  </div>
                ) : (
                  <div className="bg-white border border-mint/30 rounded-lg py-3 px-3 text-center">
                    <p className="text-sm font-semibold text-mint">Bank transfer details coming soon</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Actions */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Actions</p>
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
          </div>

        </div>
      </div>

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
