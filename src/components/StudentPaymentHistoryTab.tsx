'use client'

import { useState } from 'react'

interface Invoice {
  id: string
  termName: string
  totalAmount: number
  paidAmount: number
  status: string
  generatedAt: string
  fullyPaidAt: string | null
  lineItems: Array<{ name: string, amount: number }>
}

interface Payment {
  id: string
  amount: number
  method: string
  paidAt: string
  reference: string
  appliedTo: string
}

interface PaymentHistoryData {
  summary: {
    totalInvoiced: number
    totalPaid: number
    outstanding: number
    termsInvoiced: number
  }
  invoices: Invoice[]
  payments: Payment[]
}

interface Props {
  data: PaymentHistoryData
}

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMethod(method: string): string {
  return method
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'paid':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-mint-light text-mint rounded-full">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Paid
        </span>
      )
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2 A10 10 0 0 0 12 22 V2 Z" />
          </svg>
          Partial
        </span>
      )
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Unpaid
        </span>
      )
    default:
      return null
  }
}

export default function StudentPaymentHistoryTab({ data }: Props) {
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set())

  function toggleInvoice(invoiceId: string) {
    const newSet = new Set(expandedInvoices)
    if (newSet.has(invoiceId)) {
      newSet.delete(invoiceId)
    } else {
      newSet.add(invoiceId)
    }
    setExpandedInvoices(newSet)
  }

  return (
    <div className="space-y-6 mb-6">
      
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Total invoiced (all time)</p>
          <p className="text-2xl font-bold text-navy">{formatNaira(data.summary.totalInvoiced)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Total paid (all time)</p>
          <p className="text-2xl font-bold text-mint">{formatNaira(data.summary.totalPaid)}</p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Outstanding</p>
          <p className={`text-2xl font-bold ${data.summary.outstanding > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
            {formatNaira(data.summary.outstanding)}
          </p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Terms invoiced</p>
          <p className="text-2xl font-bold text-navy">{data.summary.termsInvoiced}</p>
        </div>
      </div>

      {/* Invoices by term */}
      <div className="bg-white p-6 rounded-xl border border-gray-200">
        <h2 className="text-navy font-semibold text-lg mb-4">Invoices by term</h2>
        
        {data.invoices.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No invoices yet for this student.</p>
        ) : (
          <div className="space-y-2">
            {data.invoices.map(invoice => {
              const isExpanded = expandedInvoices.has(invoice.id)
              const collectionPercentage = invoice.totalAmount > 0
                ? Math.round((invoice.paidAmount / invoice.totalAmount) * 100)
                : 0

              return (
                <div key={invoice.id} className="border border-gray-100 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleInvoice(invoice.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="text-left">
                      <p className="text-sm font-medium text-navy">{invoice.termName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Generated {formatDate(invoice.generatedAt)}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm text-navy">
                          {formatNaira(invoice.paidAmount)} <span className="text-gray-400">/</span> {formatNaira(invoice.totalAmount)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{collectionPercentage}% paid</p>
                      </div>
                      {getStatusBadge(invoice.status)}
                      <svg 
                        className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mt-3 mb-2">Line items</p>
                      <table className="w-full mb-3">
                        <tbody className="text-sm">
                          {(invoice.lineItems as Array<{ name: string, amount: number }>).map((item, idx) => (
                            <tr key={idx} className="border-b border-gray-50 last:border-0">
                              <td className="py-2 text-navy">{item.name}</td>
                              <td className="py-2 text-right text-navy">{formatNaira(Number(item.amount))}</td>
                            </tr>
                          ))}
                          <tr className="font-semibold">
                            <td className="py-2 text-navy">Total</td>
                            <td className="py-2 text-right text-navy">{formatNaira(invoice.totalAmount)}</td>
                          </tr>
                        </tbody>
                      </table>
                      
                      <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                        <div 
                          className={`h-2 rounded-full ${invoice.status === 'paid' ? 'bg-mint' : 'bg-amber-500'}`}
                          style={{ width: `${collectionPercentage}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        {invoice.fullyPaidAt 
                          ? `Fully paid on ${formatDate(invoice.fullyPaidAt)}`
                          : `${formatNaira(invoice.totalAmount - invoice.paidAmount)} outstanding`
                        }
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* All payments */}
      <div className="bg-white p-6 rounded-xl border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-navy font-semibold text-lg">All payments</h2>
          <p className="text-xs text-gray-500">
            Showing {data.payments.length} of {data.payments.length}
          </p>
        </div>
        
        {data.payments.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Date</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Amount</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Method</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Applied to</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.payments.map(payment => (
                  <tr key={payment.id} className="hover:bg-gray-50">
                    <td className="py-3 text-sm text-navy">{formatDate(payment.paidAt)}</td>
                    <td className="py-3 text-sm text-mint font-medium">{formatNaira(payment.amount)}</td>
                    <td className="py-3 text-sm text-gray-700">{formatMethod(payment.method)}</td>
                    <td className="py-3 text-sm text-gray-700">{payment.appliedTo}</td>
                    <td className="py-3 text-sm text-right text-gray-500 font-mono text-xs">
                      {payment.reference || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}