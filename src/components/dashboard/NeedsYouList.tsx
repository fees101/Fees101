'use client'

import { useState } from 'react'
import Link from 'next/link'
import BulkSendInvoicesPanel from '@/components/invoices/BulkSendInvoicesPanel'
import { useActiveJobs, useTrackedJob } from '@/lib/jobs/ActiveJobsProvider'

export interface NeedsYouItem {
  key: string
  title: string
  subtitle: string
  amount: number | null
  status: string
  href: string
  // Present only on the "changed and not resent" row — turns it from a plain
  // link into a "Resend now or review?" choice, so clearing the backlog
  // doesn't require a detour through the invoices list at all.
  resendCount?: number
}

interface Props {
  items: NeedsYouItem[]
  showFinancials: boolean
}

function formatNaira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

const ROW_CLASSES = 'm-row grid items-baseline gap-4 py-3.5 hover:bg-[var(--color-surface)] transition-colors w-full text-left bg-transparent border-0 cursor-pointer'
const ROW_STYLE = { gridTemplateColumns: 'minmax(0,1fr) auto auto' } as const

export default function NeedsYouList({ items, showFinancials }: Props) {
  const [choice, setChoice] = useState<{ count: number; href: string } | null>(null)
  const [resending, setResending] = useState(false)
  const { findRunningJob } = useActiveJobs()
  // A bulk_send job started here or from the invoices list both surface on
  // this row — startBulkSendInvoicesJob dedupes to one running job at a
  // time, so there's never an ambiguity about which job this progress
  // belongs to. This is what makes the row's progress a tether to the real
  // job rather than a local flag: closing the panel, or never opening it at
  // all (job started elsewhere), still leaves this row live.
  const runningSend = findRunningJob(j => j.jobType === 'bulk_send')
  const sendJob = useTrackedJob(runningSend?.jobId)
  const sending = sendJob?.status === 'running'

  return (
    <>
      <div>
        {items.map(item => {
          const showProgress = Boolean(item.resendCount) && sending && sendJob

          const content = showProgress ? (
            <>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">{item.title}</p>
                <div className="mt-2 h-[2px] w-full max-w-[240px] bg-[var(--color-neutral-300)]">
                  <div
                    className="h-full bg-[var(--color-ink)] transition-all duration-500"
                    style={{ width: `${sendJob.total > 0 ? Math.min(100, (sendJob.processed / sendJob.total) * 100) : 0}%` }}
                  />
                </div>
              </div>
              <p className="text-[15px] font-semibold text-[var(--color-ink)] text-right m-num">
                {item.amount !== null ? (showFinancials ? formatNaira(item.amount) : '—') : ''}
              </p>
              <p className="text-[12px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ink)] text-right min-w-[104px] m-num">
                Sending {sendJob.processed}/{sendJob.total}
              </p>
            </>
          ) : (
            <>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">{item.title}</p>
                <p className="text-[13px] text-[var(--color-neutral-700)] mt-[3px]">{item.subtitle}</p>
              </div>
              <p className="text-[15px] font-semibold text-[var(--color-ink)] text-right m-num">
                {item.amount !== null ? (showFinancials ? formatNaira(item.amount) : '—') : ''}
              </p>
              <p className="text-[12px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ochre-text)] text-right min-w-[104px]">
                {item.status}
              </p>
            </>
          )
          if (item.resendCount) {
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  // Sending is already underway (started here or from the
                  // invoices list) — reopen its progress panel directly
                  // rather than asking "resend now or review?" again.
                  if (sending && sendJob) {
                    setChoice({ count: sendJob.total || item.resendCount!, href: item.href })
                    setResending(true)
                    return
                  }
                  setChoice({ count: item.resendCount!, href: item.href })
                }}
                className={ROW_CLASSES}
                style={ROW_STYLE}
              >
                {content}
              </button>
            )
          }
          return (
            <Link key={item.key} href={item.href} className={ROW_CLASSES} style={ROW_STYLE}>
              {content}
            </Link>
          )
        })}
      </div>

      {choice && !resending && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
          <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full m-anim-scale">
            <div className="p-5 border-b-2 border-[var(--color-ink)] flex items-center justify-between">
              <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]">
                {choice.count} changed invoice{choice.count === 1 ? '' : 's'}
              </h3>
              <button onClick={() => setChoice(null)} aria-label="Close" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-ink)]">
                Close
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--color-neutral-700)]">
                Their parents still hold the old figures. Resend them now, or review the invoices first.
              </p>
              <div className="flex justify-end gap-2">
                <Link href={choice.href} className="m-btn m-btn-outline">Review</Link>
                <button onClick={() => setResending(true)} className="m-btn m-btn-primary">Resend now</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resending && choice && (
        <BulkSendInvoicesPanel
          count={choice.count}
          onlyNeedsResend
          skipConfirm
          onClose={() => { setResending(false); setChoice(null) }}
        />
      )}
    </>
  )
}
