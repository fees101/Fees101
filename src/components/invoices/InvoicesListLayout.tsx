'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AllInvoiceRow } from '@/lib/queries/fees'
import { bulkSendInvoices } from '@/app/(app)/invoices/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'

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
  const canSeeInvoices = useCan('see-invoices')
  const canManageInvoices = useCan('manage-invoices')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [termFilter, setTermFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [sendProgress, setSendProgress] = useState<{ sent: number; failed: number } | null>(null)
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleBulkSend() {
    if (!confirm(`Send ${counts.needsSend} unsent/needs-resend invoice(s) now?`)) return
    setSending(true)
    setSendResult(null)
    setSendProgress({ sent: 0, failed: 0 })

    let totalSent = 0
    let totalFailed = 0
    const allErrors: string[] = []

    // Loop in batches (rather than one giant request) so a large school
    // never hits a serverless function timeout, and the bonus PDF emails get
    // spread across multiple requests instead of firing all at once.
    while (true) {
      const r = await bulkSendInvoices()
      if ('error' in r) { setSendResult({ ok: false, message: r.error }); break }
      totalSent += r.sent
      totalFailed += r.failed
      allErrors.push(...r.errors.map(e => e.error))
      setSendProgress({ sent: totalSent, failed: totalFailed })
      if (r.remaining === 0) {
        setSendResult({
          ok: totalFailed === 0,
          message: totalFailed === 0
            ? `Sent ${totalSent} invoice(s).`
            : `Sent ${totalSent}, failed ${totalFailed}: ${allErrors.join('; ')}`,
        })
        break
      }
    }

    setSending(false)
    setSendProgress(null)
    router.refresh()
  }

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
    needsSend: invoices.filter(i => i.status !== 'cancelled' && i.outstandingAmount > 0 && (!i.sentAt || i.needsResend)).length,
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
        {canManageInvoices && counts.needsSend > 0 && (
          <div className="text-right">
            <button
              onClick={handleBulkSend}
              disabled={sending}
              className="px-4 py-2 bg-mint text-navy rounded-lg text-sm font-semibold hover:bg-mint/90 disabled:opacity-50"
            >
              {sending ? `Sending… (${sendProgress?.sent ?? 0} sent)` : `Send all (${counts.needsSend})`}
            </button>
            {sendResult && (
              <p className={`text-xs mt-1 max-w-xs ${sendResult.ok ? 'text-mint' : 'text-red-600'}`}>{sendResult.message}</p>
            )}
          </div>
        )}
      </header>

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
                        <td className="py-3 px-4 text-sm text-right text-navy">{formatNaira(inv.totalAmount)}</td>
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
