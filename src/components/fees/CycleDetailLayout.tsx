'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CycleDetailData, InvoiceRow } from '@/lib/queries/fees'
import GenerateInvoicesPanel from './GenerateInvoicesPanel'
import { regenerateInvoice, regenerateStaleInvoicesForCycle } from '@/app/(app)/fees/cycles/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'

interface Props {
  data: CycleDetailData
  showFinancials?: boolean
}

type Filter = 'all' | 'paid' | 'partial' | 'unpaid' | 'needs_resend' | 'out_of_date' | 'no_invoice'

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

export default function CycleDetailLayout({ data, showFinancials = true }: Props) {
  const router = useRouter()
  const canManageFeeStructure = useCan('manage-fee-structure')
  const canManageInvoices = useCan('manage-invoices')
  const { cycle, invoices, studentsWithoutInvoices, totalActiveStudents, totalsByStatus } = data

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [generatePanelOpen, setGeneratePanelOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [regeneratingAll, setRegeneratingAll] = useState(false)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [regenerateSummary, setRegenerateSummary] = useState<string | null>(null)

  const filteredInvoices = useMemo(() => {
    const term = search.toLowerCase().trim()
    return invoices.filter(inv => {
      if (filter === 'paid' && inv.status !== 'paid') return false
      if (filter === 'partial' && inv.status !== 'partial') return false
      if (filter === 'unpaid' && (inv.status === 'paid' || inv.status === 'partial')) return false
      if (filter === 'needs_resend' && !inv.needsResend) return false
      if (filter === 'out_of_date' && !inv.needsRegeneration) return false
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

  async function handleRegenerateAll() {
    if (!cycle) return
    setError(null)
    setRegeneratingAll(true)
    const result = await regenerateStaleInvoicesForCycle(cycle.id)
    if ('error' in result) {
      setError(result.error)
    } else {
      setRegenerateSummary(
        `${result.regenerated} ${result.regenerated === 1 ? 'invoice' : 'invoices'} updated to current fees.`
      )
      router.refresh()
    }
    setRegeneratingAll(false)
  }

  async function handleRegenerateOne(invoiceId: string) {
    setError(null)
    setRegeneratingId(invoiceId)
    const result = await regenerateInvoice(invoiceId)
    if ('error' in result) {
      setError(result.error)
    } else {
      if (result.wasOverpaid) {
        setError('Invoice updated — the new total is now less than what the student has already paid. Review for a possible refund or credit.')
      }
      router.refresh()
    }
    setRegeneratingId(null)
  }

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
            {isClosed && cycle.closedAt ? `Closed: ${formatDate(cycle.closedAt)}` : `Due: ${formatDate(cycle.dueDate)}`}
            {cycle.sessionName && (
              <>
                <span className="text-gray-400 font-bold"> · </span>
                Session: {cycle.sessionName}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManageFeeStructure && (
          <Link
            href={`/fees/structure?cycle=${cycle.id}`}
            className="px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Edit fees
          </Link>
          )}
          {hasInvoices && (

              <a href={`/api/cycles/${cycle.id}/pdf`}
              download
              className="px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print all ({invoices.length})
            </a>
          )}
          {!isClosed && canManageInvoices && (
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

      {!isClosed && totalsByStatus.needsRegeneration > 0 && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-navy">
              {totalsByStatus.needsRegeneration} {totalsByStatus.needsRegeneration === 1 ? 'invoice is' : 'invoices are'} out of date
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              Fees, opt-ins, or exemptions changed since these were generated. Regenerate to apply the current numbers — payments already made are preserved.
            </p>
          </div>
          {canManageInvoices && (
          <button
            onClick={handleRegenerateAll}
            disabled={regeneratingAll}
            className="px-3 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 flex-shrink-0"
          >
            {regeneratingAll ? 'Regenerating...' : 'Regenerate all'}
          </button>
          )}
        </div>
      )}

      {regenerateSummary && (
        <div className="mb-4 p-3 bg-mint-light/40 border border-mint/30 rounded-lg text-sm text-navy flex items-center justify-between">
          {regenerateSummary}
          <button onClick={() => setRegenerateSummary(null)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className={`grid grid-cols-2 gap-4 mb-6 ${showFinancials ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Invoices</p>
          <p className="text-2xl font-bold text-navy">
            {invoices.length} <span className="text-sm text-gray-400">/ {totalActiveStudents}</span>
          </p>
          {studentsWithoutInvoices.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">{studentsWithoutInvoices.length} students missing</p>
          )}
        </div>
        {showFinancials && (
          <div className="bg-white p-4 rounded-xl border border-gray-200">
            <p className="text-xs text-gray-500 mb-1">Expected</p>
            <p className="text-2xl font-bold text-navy">{formatNaira(cycle.totalExpected)}</p>
          </div>
        )}
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Collected</p>
          <p className="text-2xl font-bold text-mint">
            {showFinancials
              ? formatNaira(cycle.totalCollected)
              : `${cycle.totalExpected > 0 ? Math.round((cycle.totalCollected / cycle.totalExpected) * 100) : 0}%`}
          </p>
          {cycle.totalExpected > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {showFinancials ? `${Math.round((cycle.totalCollected / cycle.totalExpected) * 100)}% collected` : 'of expected'}
              {invoices.length > 0 && ` · ${totalsByStatus.paid}/${invoices.length} paid up`}
            </p>
          )}
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">Outstanding</p>
          <p className="text-2xl font-bold text-amber-600">
            {showFinancials
              ? formatNaira(cycle.totalOutstanding)
              : `${cycle.totalExpected > 0 ? Math.round((cycle.totalOutstanding / cycle.totalExpected) * 100) : 0}%`}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {!showFinancials && 'of expected, still owed'}
            {invoices.length > 0 && `${!showFinancials ? ' · ' : ''}${totalsByStatus.partial + totalsByStatus.pending + totalsByStatus.overdue}/${invoices.length} owe`}
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
          {totalsByStatus.needsRegeneration > 0 && (
            <button
              onClick={() => setFilter('out_of_date')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${filter === 'out_of_date' ? 'bg-amber-200 text-amber-800' : 'bg-white border border-gray-200 text-amber-700 hover:bg-amber-50'}`}
            >
              Out of date {totalsByStatus.needsRegeneration}
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
          {!isClosed && canManageInvoices && (
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
                <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Invoice #</th>
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
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="py-3 px-4 text-sm text-gray-500">
                      {inv.invoiceNumber || '—'}
                    </td>
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
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${b.cls}`}>
                          {b.label}
                        </span>
                        {inv.needsRegeneration && (
                          <>
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800">
                              out of date
                            </span>
                            {canManageInvoices && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRegenerateOne(inv.id)
                              }}
                              disabled={regeneratingId === inv.id}
                              className="text-xs text-mint font-medium hover:underline disabled:opacity-50"
                            >
                              {regeneratingId === inv.id ? 'Regenerating...' : 'Regenerate'}
                            </button>
                            )}
                          </>
                        )}
                      </div>
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
                  <td className="py-3 px-4 text-sm text-gray-400">—</td>
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