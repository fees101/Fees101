'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CycleDetailData, InvoiceRow } from '@/lib/queries/fees'
import GenerateInvoicesPanel from './GenerateInvoicesPanel'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  data: CycleDetailData
}

type Filter = 'all' | 'paid' | 'partial' | 'unpaid' | 'needs_resend' | 'no_invoice'

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function statusBadge(inv: InvoiceRow) {
  if (inv.needsResend) return { cls: 'bg-amber-50 text-amber-700', label: 'needs resend' }
  if (inv.status === 'paid') return { cls: 'bg-mint-light text-mint', label: 'paid' }
  if (inv.status === 'partial') return { cls: 'bg-amber-50 text-amber-700', label: 'partial' }
  if (inv.status === 'overdue') return { cls: 'bg-red-50 text-red-700', label: 'overdue' }
  if (inv.status === 'cancelled') return { cls: 'bg-gray-100 text-gray-500', label: 'cancelled' }
  return { cls: 'bg-gray-100 text-gray-600', label: 'unpaid' }
}

function cycleStatusBadge(status: 'draft' | 'active' | 'closed') {
  if (status === 'active') return { cls: 'bg-mint-light text-mint', dot: 'bg-mint' }
  if (status === 'draft') return { cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' }
  return { cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' }
}

export default function CycleDetailLayout({ data }: Props) {
  const router = useRouter()
  const { cycle, invoices, studentsWithoutInvoices, totalActiveStudents, totalsByStatus } = data

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [generatePanelOpen, setGeneratePanelOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredInvoices = useMemo(() => {
    const term = search.toLowerCase().trim()
    return invoices.filter(inv => {
      if (filter === 'paid' && inv.status !== 'paid') return false
      if (filter === 'partial' && inv.status !== 'partial') return false
      if (filter === 'unpaid' && (inv.status === 'paid' || inv.status === 'partial')) return false
      if (filter === 'needs_resend' && !inv.needsResend) return false
      if (filter === 'no_invoice') return false
      if (term) {
        const fullName = `${inv.studentFirstName} ${inv.studentLastName}`.toLowerCase()
        return fullName.includes(term) || inv.studentAdmissionNumber.toLowerCase().includes(term)
      }
      return true
    })
  }, [invoices, filter, search])

  const filteredNoInvoice = useMemo(() => {
    if (filter !== 'no_invoice' && filter !== 'all') return []
    const term = search.toLowerCase().trim()
    return studentsWithoutInvoices.filter(s => {
      if (!term) return true
      const fullName = `${s.firstName} ${s.lastName}`.toLowerCase()
      return fullName.includes(term) || s.admissionNumber.toLowerCase().includes(term)
    })
  }, [studentsWithoutInvoices, filter, search])

  if (!cycle) {
    return (
      <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
        <p className="text-gray-500">Term not found.</p>
      </div>
    )
  }

  const badge = cycleStatusBadge(cycle.status)
  const isClosed = cycle.status === 'closed'
  const isDraft = cycle.status === 'draft'
  const hasInvoices = invoices.length > 0
  const canGenerate = !isClosed && studentsWithoutInvoices.length > 0

  return (
    <>
      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full ${badge.dot}`}></span>
            <h1 className="text-3xl font-bold text-navy">{cycle.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>
              {cycle.status}
            </span>
          </div>
          <p className="text-sm text-gray-500">
            {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
            <span className="text-gray-400 font-bold"> · </span>
            Due: {formatDate(cycle.dueDate)}
            {cycle.sessionName && (
              <>
                <span className="text-gray-400 font-bold"> · </span>
                Session: {cycle.sessionName}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/fees/structure?cycle=${cycle.id}`}
            className="px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Edit fees
          </Link>
          {!isClosed && (
            <button
              onClick={() => setGeneratePanelOpen(true)}
              disabled={studentsWithoutInvoices.length === 0}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50"
            >
              {hasInvoices ? `Generate for ${studentsWithoutInvoices.length} new` : `Generate invoices`}
            </button>
          )}
        </div>
      </header>

      {isClosed && (
        <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-navy">This term is closed</p>
            <p className="text-xs text-gray-600 mt-0.5">No new invoices can be generated. Payments can still be recorded.</p>
          </div>
        </div>
      )}

      {isDraft && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-navy">This is a draft term</p>
            <p className="text-xs text-gray-600 mt-0.5">
              You can generate invoices to draft them in advance (e.g., to print and slot into student report cards). Activate the term from <Link href="/fees/cycles" className="text-mint hover:underline">Billing cycles</Link> when ready.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Invoices</p>
          <p className="text-2xl font-bold text-navy">
            {invoices.length} <span className="text-sm text-gray-400">/ {totalActiveStudents}</span>
          </p>
          {studentsWithoutInvoices.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">{studentsWithoutInvoices.length} students missing</p>
          )}
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Expected</p>
          <p className="text-2xl font-bold text-navy">{formatNaira(cycle.totalExpected)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Collected</p>
          <p className="text-2xl font-bold text-mint">{formatNaira(cycle.totalCollected)}</p>
          {cycle.totalExpected > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {Math.round((cycle.totalCollected / cycle.totalExpected) * 100)}% collected
            </p>
          )}
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Outstanding</p>
          <p className="text-2xl font-bold text-amber-600">
            {formatNaira(cycle.totalExpected - cycle.totalCollected)}
          </p>
        </div>
      </div>

      {/* Filters */}
      {(hasInvoices || studentsWithoutInvoices.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'all' ? 'bg-navy text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            All {invoices.length + studentsWithoutInvoices.length}
          </button>
          <button
            onClick={() => setFilter('paid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'paid' ? 'bg-mint text-navy' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Paid {totalsByStatus.paid}
          </button>
          <button
            onClick={() => setFilter('partial')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Partial {totalsByStatus.partial}
          </button>
          <button
            onClick={() => setFilter('unpaid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'unpaid' ? 'bg-gray-200 text-gray-800' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Unpaid {totalsByStatus.pending + totalsByStatus.overdue}
          </button>
          {totalsByStatus.needsResend > 0 && (
            <button
              onClick={() => setFilter('needs_resend')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'needs_resend' ? 'bg-amber-200 text-amber-800' : 'bg-white border border-gray-200 text-amber-700 hover:bg-amber-50'}`}
            >
              Needs resend {totalsByStatus.needsResend}
            </button>
          )}
          {studentsWithoutInvoices.length > 0 && (
            <button
              onClick={() => setFilter('no_invoice')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'no_invoice' ? 'bg-red-100 text-red-800' : 'bg-white border border-gray-200 text-red-700 hover:bg-red-50'}`}
            >
              No invoice {studentsWithoutInvoices.length}
            </button>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or admission #"
            className="ml-auto px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 w-64"
          />
        </div>
      )}

      {/* Empty state */}
      {!hasInvoices && studentsWithoutInvoices.length === 0 && (
        <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
          <p className="text-gray-500 mb-2">No active students yet.</p>
          <Link href="/students" className="text-mint hover:underline text-sm">
            Add students →
          </Link>
        </div>
      )}

      {!hasInvoices && studentsWithoutInvoices.length > 0 && (
        <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
          <p className="text-gray-500 mb-2">No invoices generated for this term yet.</p>
          <p className="text-sm text-gray-400 mb-4">
            {studentsWithoutInvoices.length} active {studentsWithoutInvoices.length === 1 ? 'student' : 'students'} ready to be invoiced
          </p>
          {!isClosed && (
            <button
              onClick={() => setGeneratePanelOpen(true)}
              className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
            >
              Generate invoices
            </button>
          )}
        </div>
      )}

      {/* Invoices table */}
      {(filteredInvoices.length > 0 || filteredNoInvoice.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Student</th>
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Class</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Total</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Paid</th>
                <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Outstanding</th>
                <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredInvoices.map(inv => {
                const b = statusBadge(inv)
                return (
                  <tr 
                    key={inv.id}
                    onClick={() => router.push(`/students/${inv.studentId}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="py-3 px-4 text-sm text-navy font-medium">
                      {inv.studentFirstName} {inv.studentLastName}
                      <p className="text-xs text-gray-500 mt-0.5">#{inv.studentAdmissionNumber}</p>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-700">{inv.className}</td>
                    <td className="py-3 px-4 text-sm text-right text-navy">
                      {formatNaira(inv.totalAmount)}
                      {inv.previousBalance > 0 && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          incl. {formatNaira(inv.previousBalance)} prev. balance
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-right">
                      <span className={inv.paidAmount > 0 ? 'text-mint font-medium' : 'text-gray-400'}>
                        {formatNaira(inv.paidAmount)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-right">
                      <span className={inv.outstandingAmount > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                        {formatNaira(inv.outstandingAmount)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${b.cls}`}>
                        {b.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {filteredNoInvoice.map(s => (
                <tr
                  key={s.id}
                  onClick={() => router.push(`/students/${s.id}?tab=fees`)}
                  className="cursor-pointer hover:bg-gray-50 bg-red-50/30"
                >
                  <td className="py-3 px-4 text-sm text-navy font-medium">
                    {s.firstName} {s.lastName}
                    <p className="text-xs text-gray-500 mt-0.5">#{s.admissionNumber}</p>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-700">
                    {s.className || <span className="text-red-600">No class</span>}
                  </td>
                  <td colSpan={3} className="py-3 px-4 text-sm text-gray-400 italic text-center">
                    No invoice yet
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                      no invoice
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {generatePanelOpen && (
        <GenerateInvoicesPanel
          cycleId={cycle.id}
          onClose={() => setGeneratePanelOpen(false)}
          onSuccess={() => {
            setGeneratePanelOpen(false)
            router.refresh()
          }}
        />
      )}
    </>
  )
}