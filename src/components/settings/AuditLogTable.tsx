'use client'

import { useMemo, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { AuditLogRow } from '@/lib/audit/auditLog'
import { AUDIT_LOG_GROUPS } from '@/lib/audit/auditLogGroups'

const ACTION_LABELS: Record<string, string> = {
  'staff.added': 'Staff added',
  'staff.role_changed': 'Role changed',
  'staff.email_changed': 'Email changed',
  'staff.activated': 'Staff activated',
  'staff.deactivated': 'Staff deactivated',
  'staff.invite_resent': 'Invite resent',
  'staff.password_reset_sent': 'Password reset sent',
  'role.created': 'Role created',
  'role.renamed': 'Role renamed',
  'role.deleted': 'Role deleted',
  'role.permissions_changed': 'Permissions changed',
  'discount.approved': 'Discount approved',
  'discount.rejected': 'Discount rejected',
  'discount.recurring_revoked': 'Recurring discount revoked',
  'invoice.sent': 'Invoice sent',
  'invoice.sent_bulk': 'Invoices sent (bulk)',
  'invoice.generated': 'Invoice generated',
  'invoice.generated_bulk': 'Invoices generated (bulk)',
  'invoice.regenerated': 'Invoice regenerated',
  'invoice.regenerated_bulk': 'Invoices regenerated (bulk)',
  'discount.requested': 'Discount requested',
  'student.added': 'Student added',
  'student.imported': 'Students imported',
  'student.updated': 'Student updated',
  'student.status_changed': 'Student status changed',
  'student.opt_in_toggled': 'Fee opt-in toggled',
  'student.opt_in_bulk_updated': 'Fee opt-ins updated (bulk)',
  'student.exemption_set': 'Exemption set',
  'student.exemption_removed': 'Exemption removed',
  'student.dva_created': 'Payment account created',
  'student.dva_bulk_created': 'Payment accounts created (bulk)',
  'student.reminder_sent': 'Manual reminder sent',
  'family.updated': 'Family info updated',
  'family.notes_updated': 'Family notes updated',
  'class.added': 'Class added',
  'class.updated': 'Class updated',
  'class.active_toggled': 'Class active status toggled',
  'section.added': 'Section added',
  'section.updated': 'Section updated',
  'section.deleted': 'Section deleted',
  'session.created': 'Session created',
  'session.activated': 'Session activated',
  'session.closed': 'Session closed',
  'term.created': 'Term created',
  'term.updated': 'Term updated',
  'term.closed_carried_forward': 'Term closed & carried forward',
  'term.activated': 'Term activated',
  'term.closed': 'Term closed',
  'term.reopened_draft': 'Term reopened as draft',
  'term.draft_deleted': 'Term draft deleted',
  'year_end.started': 'Year-end rollover started',
  'year_end.resumed': 'Year-end rollover resumed',
  'year_end.cancelled': 'Year-end rollover cancelled',
  'fee_item.added': 'Fee item added',
  'fee_item.updated': 'Fee item updated',
  'fee_item.deleted': 'Fee item deleted',
  'fee_item.bulk_deleted': 'Fee items deleted (bulk)',
  'fee_group.updated': 'Fee group updated',
  'payment.reconciliation_run': 'Payment reconciliation run',
  'payment.applied': 'Payment applied',
  'school.updated': 'School profile updated',
  'school.logo_uploaded': 'School logo uploaded',
  'school.logo_removed': 'School logo removed',
  'payment_config.updated': 'Payment provider settings updated',
  'discount_config.updated': 'Discount policy updated',
  'reminder_config.updated': 'Reminder settings updated',
  'account.password_changed': 'Password changed',
  'report.audit_log_downloaded': 'Audit log downloaded',
}

const PAGE_SIZE_OPTIONS = [50, 100, 200]

function getPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (currentPage <= 3) return [1, 2, 3, 4, '...', totalPages]
  if (currentPage >= totalPages - 2) {
    return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  events: AuditLogRow[]
  total: number
  page: number
  perPage: number
  group: string
  from: string
  to: string
}

// Category, date range and page are server-driven (via the URL) so they scope
// the actual query instead of just hiding rows already on the page — the log
// can hold far more history than any one page will ever fetch. The free-text
// search stays client-side, refining within whatever page is loaded.
export default function AuditLogTable({ events, total, page, perPage, group, from, to }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState('')

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({ page: String(patch.page ?? '1'), group, from, to, ...patch })
    for (const key of Array.from(params.keys())) {
      if (!params.get(key)) params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    if (!term) return events
    return events.filter((e) =>
      e.summary.toLowerCase().includes(term) ||
      e.actorName.toLowerCase().includes(term) ||
      actionLabel(e.action).toLowerCase().includes(term)
    )
  }, [events, search])

  const selectClass =
    'rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-navy focus:border-mint focus:outline-none'

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-5 flex items-center justify-between gap-4 flex-wrap border-b border-gray-100">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {total === 0 ? '0 events' : `${rangeStart}–${rangeEnd} of ${total} events`}
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={group} onChange={(e) => navigate({ group: e.target.value, page: '1' })} className={selectClass}>
            <option value="all">All types</option>
            {AUDIT_LOG_GROUPS.map((g) => (
              <option key={g.label} value={g.label}>{g.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={from}
              onChange={(e) => navigate({ from: e.target.value, page: '1' })}
              aria-label="From date"
              className={selectClass}
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="date"
              value={to}
              onChange={(e) => navigate({ to: e.target.value, page: '1' })}
              aria-label="To date"
              className={selectClass}
            />
            {(from || to) && (
              <button
                onClick={() => navigate({ from: '', to: '', page: '1' })}
                className="text-xs text-gray-400 hover:text-navy px-1"
              >
                Clear
              </button>
            )}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this page by summary or staff name"
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-mint/40 w-72"
          />
        </div>
      </div>

      {total === 0 ? (
        <p className="p-5 text-sm text-gray-500">
          {group === 'all' && !from && !to
            ? 'Nothing has happened yet — actions like role changes and discount approvals will show up here.'
            : 'No events match this filter.'}
        </p>
      ) : filtered.length === 0 ? (
        <p className="p-5 text-sm text-gray-500">No events on this page match your search.</p>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Who</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{formatWhen(e.createdAt)}</td>
                  <td className="px-5 py-3 text-navy">{e.actorName}</td>
                  <td className="px-5 py-3 text-navy font-medium whitespace-nowrap">{actionLabel(e.action)}</td>
                  <td className="px-5 py-3 text-gray-600">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              Showing {rangeStart}-{rangeEnd} of {total} events
            </span>
            <label className="flex items-center gap-1.5 text-sm text-gray-500">
              Per page
              <select
                value={perPage}
                onChange={(e) => navigate({ perPage: e.target.value, page: '1' })}
                className={selectClass}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate({ page: String(page - 1) })}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-navy disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            {getPageNumbers(page, totalPages).map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-sm text-gray-400">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => navigate({ page: String(p) })}
                  className={`min-w-[2.25rem] px-2.5 py-1.5 rounded-lg text-sm ${
                    p === page ? 'bg-navy text-white font-medium' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => navigate({ page: String(page + 1) })}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-navy disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
