'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { dismissAdminNotification, dismissFlaggedPaymentNotifications } from '@/app/(app)/notifications-actions'
import { formatDateTime } from '@/lib/format/date'
import type { FlaggedPaymentRow } from '@/lib/queries/flaggedPayments'

// The Record feed's search matches a payment's amount EXACTLY (applySearch in
// activity.ts), so an amount + the day the flag was raised pins down the real
// transaction, not just "somewhere in this student's whole history". Rows from
// before the `amount` column existed fall back to no link here (the "Open full
// Record" link at the bottom still works, just unscoped).
function recordLinkFor(n: FlaggedPaymentRow): string | null {
  if (n.amount === null) return null
  const day = n.createdAt.slice(0, 10)
  const params = new URLSearchParams({ category: 'payments', search: String(n.amount), from: day, to: day })
  return `/today/record?${params.toString()}`
}

export default function FlaggedPaymentsList({
  initialRows, total, page, perPage,
}: {
  initialRows: FlaggedPaymentRow[]
  total: number
  page: number
  perPage: number
}) {
  const router = useRouter()
  const [rows, setRows] = useState(initialRows)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)

  async function dismissOne(id: string) {
    setDismissingId(id)
    await dismissAdminNotification(id)
    setRows(prev => prev.filter(r => r.id !== id))
    setDismissingId(null)
    router.refresh()
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  return (
    <div className="m-panel">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-neutral-700)]">Flagged payments</p>
          <p className="text-[13px] text-[var(--color-neutral-700)] max-w-[52ch]">
            Came through the payment pipeline but looked unusual — an odd amount, a repeat on the terminal, or a
            mismatch. Open the student or find the exact payment to check it, or mark it reviewed.
          </p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={async () => {
              setClearingAll(true)
              await dismissFlaggedPaymentNotifications()
              setClearingAll(false)
              router.refresh()
            }}
            disabled={clearingAll}
            className="m-btn m-btn-outline whitespace-nowrap"
          >
            {clearingAll ? 'Clearing…' : 'Mark all reviewed'}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-neutral-700)] py-6">Nothing flagged right now.</p>
      ) : (
        <div className="divide-y divide-[var(--color-neutral-300)]">
          {rows.map(n => {
            const recordLink = recordLinkFor(n)
            return (
            <div key={n.id} className="py-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">{n.title}</p>
                <p className="text-[13px] text-[var(--color-neutral-800)] mt-1 leading-[1.5] max-w-[70ch]">{n.body}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                  <p className="text-[12px] text-[var(--color-neutral-500)] m-num">{formatDateTime(n.createdAt)}</p>
                  {n.studentId && (
                    <>
                      <span className="text-[var(--color-neutral-400)]">·</span>
                      <Link href={`/students/${n.studentId}`} className="text-[12px] font-semibold text-[var(--color-ink)] underline">
                        {n.studentName || 'View student'}
                      </Link>
                    </>
                  )}
                  {!n.studentId && n.familyId && (
                    <>
                      <span className="text-[var(--color-neutral-400)]">·</span>
                      <span className="text-[12px] text-[var(--color-neutral-700)]">
                        {n.familyName ? `${n.familyName}'s family` : 'Family payment'}
                      </span>
                    </>
                  )}
                  {recordLink && (
                    <>
                      <span className="text-[var(--color-neutral-400)]">·</span>
                      <Link href={recordLink} className="text-[12px] font-semibold text-[var(--color-ink)] underline">
                        Find this payment
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => dismissOne(n.id)}
                disabled={dismissingId === n.id}
                className="m-btn m-btn-outline m-btn-sm whitespace-nowrap shrink-0"
              >
                {dismissingId === n.id ? 'Clearing…' : 'Mark reviewed'}
              </button>
            </div>
            )
          })}
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5 mt-2 border-t border-[var(--color-neutral-300)]">
          <span className="m-num text-[13px] text-[var(--color-neutral-700)]">
            Showing {rangeStart}–{rangeEnd} of {total}
          </span>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/today/flagged?page=${page - 1}`}
              aria-disabled={page <= 1}
              className={`px-2 py-2 text-[13px] font-semibold ${page <= 1 ? 'pointer-events-none opacity-40 text-[var(--color-neutral-700)]' : 'text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]'}`}
            >
              ← Newer
            </Link>
            <span className="m-num px-1.5 text-[13px]">{page} / {totalPages}</span>
            <Link
              href={`/today/flagged?page=${page + 1}`}
              aria-disabled={page >= totalPages}
              className={`px-2 py-2 text-[13px] font-semibold ${page >= totalPages ? 'pointer-events-none opacity-40 text-[var(--color-neutral-700)]' : 'text-[var(--color-neutral-700)] hover:text-[var(--color-ink)]'}`}
            >
              Older →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
