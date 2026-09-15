'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AllInvoiceRow } from '@/lib/queries/fees'
import { useCan } from '@/lib/auth/PermissionsProvider'
import { useActiveJobs, useOnJobOpenRequested } from '@/lib/jobs/ActiveJobsProvider'
import BulkSendInvoicesPanel from '@/components/invoices/BulkSendInvoicesPanel'

interface Props {
  invoices: AllInvoiceRow[]
}

type StatusFilter = 'all' | 'paid' | 'partial' | 'unpaid' | 'needs_resend'

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function statusBadge(inv: AllInvoiceRow) {
  if (inv.needsResend) return { cls: 'bg-amber-50 text-amber-700', label: 'needs resend' }
  if (inv.status === 'paid') return { cls: 'bg-mint-light text-mint', label: 'paid' }
  if (inv.status === 'partial') return { cls: 'bg-amber-50 text-amber-700', label: 'partial' }
  if (inv.status === 'overdue') return { cls: 'bg-red-50 text-red-700', label: 'overdue' }
  if (inv.status === 'cancelled') return { cls: 'bg-gray-100 text-gray-500', label: 'cancelled' }
  return { cls: 'bg-gray-100 text-gray-600', label: 'unpaid' }
}

export default function InvoicesListLayout({ invoices }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const canSeeInvoices = useCan('see-invoices')
  const canManageInvoices = useCan('manage-invoices')
  // Pre-select a filter from a link elsewhere in the app (e.g. the dashboard's
  // "invoices changed — not resent" KPI card) instead of always landing on
  // 'all'.
  const initialFilter = searchParams.get('filter')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialFilter === 'needs_resend' || initialFilter === 'paid' || initialFilter === 'partial' || initialFilter === 'unpaid'
      ? initialFilter
      : 'all'
  )
  const [termFilter, setTermFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const { findRunningJob } = useActiveJobs()
  // Re-derived every render (not frozen in useState) so the button stays
  // disabled with a live "Sending..." label for as long as the job is
  // actually running — including after the panel below has been closed via
  // "Run in background", when this component is the only thing left tracking
  // whether a send is still in flight.
  const existingJob = findRunningJob(j => j.jobType === 'bulk_send')
  // Reopen the modal automatically if a send is already running (e.g. the
  // user navigated away with "Run in background" and came back) — the panel
  // itself resumes tracking the existing job instead of starting a new one.
  const [bulkSendOpen, setBulkSendOpen] = useState(!!existingJob)
  const sendRunning = !!existingJob
  // Clicking the chip while already on this page doesn't navigate anywhere,
  // so force the panel open explicitly rather than relying on a remount.
  useOnJobOpenRequested(existingJob?.jobId, () => setBulkSendOpen(true))

  const terms = useMemo(() => {
    const seen = new Map<string, string>()
    invoices.forEach(inv => {
      if (inv.cycleId && !seen.has(inv.cycleId)) seen.set(inv.cycleId, inv.cycleName)
    })
    return Array.from(seen.entries())
  }, [invoices])

  const counts = useMemo(() => ({
    all: invoices.length,
    paid: invoices.filter(i => i.status === 'paid').length,
    partial: invoices.filter(i => i.status === 'partial').length,
    unpaid: invoices.filter(i => i.status !== 'paid' && i.status !== 'partial').length,
    needsResend: invoices.filter(i => i.needsResend).length,
    needsSend: invoices.filter(i => i.status !== 'cancelled' && i.cycleStatus !== 'closed' && i.outstandingAmount > 0 && (!i.sentAt || i.needsResend)).length,
  }), [invoices])

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return invoices.filter(inv => {
      if (termFilter !== 'all' && inv.cycleId !== termFilter) return false
      if (statusFilter === 'paid' && inv.status !== 'paid') return false
      if (statusFilter === 'partial' && inv.status !== 'partial') return false
      if (statusFilter === 'unpaid' && (inv.status === 'paid' || inv.status === 'partial')) return false
      if (statusFilter === 'needs_resend' && !inv.needsResend) return false
      if (term) {
        const fullName = `${inv.studentFirstName} ${inv.studentLastName}`.toLowerCase()
        return (
          fullName.includes(term) ||
          inv.studentAdmissionNumber.toLowerCase().includes(term) ||
          (inv.invoiceNumber || '').toLowerCase().includes(term)
        )
      }
      return true
    })
  }, [invoices, statusFilter, termFilter, search])

  return (
    <>
      {!canSeeInvoices ? null : (
      <>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-navy">Invoices</h1>
          <p className="text-gray-500 mt-2 text-sm">Every invoice across every term</p>
        </div>
        {canManageInvoices && (counts.needsSend > 0 || sendRunning) && (
          <div className="text-right">
            <button
              onClick={() => setBulkSendOpen(true)}
              disabled={bulkSendOpen && sendRunning}
              title={sendRunning && !bulkSendOpen ? 'A send is already running — click to view its progress' : undefined}
              className="px-4 py-2 bg-mint text-navy rounded-lg text-sm font-semibold hover:bg-mint/90 disabled:opacity-50"
            >
              {sendRunning ? `Sending… (${existingJob.processed} sent)` : `Send all (${counts.needsSend})`}
            </button>
          </div>
        )}
      </header>

      {bulkSendOpen && (
        <BulkSendInvoicesPanel count={counts.needsSend} onClose={() => setBulkSendOpen(false)} />
      )}

      {invoices.length === 0 ? (
        <div className="bg-white p-12 rounded-xl border border-gray-200 text-center">
          <p className="text-gray-500">No invoices generated yet.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${statusFilter === 'all' ? 'bg-navy text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              All {counts.all}
            </button>
            <button
              onClick={() => setStatusFilter('paid')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${statusFilter === 'paid' ? 'bg-mint text-navy' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              Paid {counts.paid}
            </button>
            <button
              onClick={() => setStatusFilter('partial')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${statusFilter === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              Partial {counts.partial}
            </button>
            <button
              onClick={() => setStatusFilter('unpaid')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${statusFilter === 'unpaid' ? 'bg-gray-200 text-gray-800' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              Unpaid {counts.unpaid}
            </button>
            {counts.needsResend > 0 && (
              <button
                onClick={() => setStatusFilter('needs_resend')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${statusFilter === 'needs_resend' ? 'bg-amber-200 text-amber-800' : 'bg-white border border-gray-200 text-amber-700 hover:bg-amber-50'}`}
              >
                Needs resend {counts.needsResend}
              </button>
            )}

            <select
              value={termFilter}
              onChange={(e) => setTermFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-md text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-mint/40"
            >
              <option value="all">All terms</option>
              {terms.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, admission #, or invoice #"
              className="ml-auto px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 w-72"
            />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Invoice #</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Student</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Class</th>
                  <th className="text-left text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Term</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Total</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Paid</th>
                  <th className="text-right text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Outstanding</th>
                  <th className="text-center text-xs text-gray-500 font-medium uppercase tracking-wider py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-sm text-gray-500">
                      No invoices match this filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map(inv => {
                    const b = statusBadge(inv)
                    return (
                      <tr
                        key={inv.id}
                        onClick={() => router.push(`/invoices/${inv.id}`)}
                        className="cursor-pointer hover:bg-gray-50"
                      >
                        <td className="py-3 px-4 text-sm text-gray-500">{inv.invoiceNumber || '—'}</td>
                        <td className="py-3 px-4 text-sm text-navy font-medium">
                          {inv.studentFirstName} {inv.studentLastName}
                          <p className="text-xs text-gray-500 mt-0.5">#{inv.studentAdmissionNumber}</p>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-700">{inv.className}</td>
                        <td className="py-3 px-4 text-sm text-gray-700">
                          {inv.cycleName}
                          {inv.cycleStatus === 'closed' && (
                            <span className="ml-1.5 text-xs text-gray-400">(closed)</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-navy">
                          {formatNaira(inv.totalAmount)}
                          {inv.creditApplied > 0 && (
                            <p className="text-xs text-mint mt-0.5">
                              − {formatNaira(inv.creditApplied)} credit
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
                          {inv.carriedForwardToCycleName && (
                            <p className="text-xs text-gray-400 mt-0.5">→ {inv.carriedForwardToCycleName}</p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${b.cls}`}>
                            {b.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      </>
      )}
    </>
  )
}
