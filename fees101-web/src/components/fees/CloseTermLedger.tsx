'use client'

// The Close term tab — a first-class surface in the redesign (was a thin
// figures-free modal buried in cycle detail). It follows the App Shell
// "pre-run ledger" pattern: a 2px ink rule, the term being closed named in
// the title, an ochre warn line when the term isn't due yet, then an itemised
// "what closing will do" ledger — every student and every naira that moves,
// stated before anything happens. Colour carries meaning: ink for a neutral
// fact, ochre for money/balances carried forward or a thing awaiting a human,
// green only where money sits in a family's favour, dim for a zero.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CycleRow } from '@/lib/queries/fees'
import { closeTerm, activateTerm } from '@/app/(app)/fees/cycles/actions'
import { useActiveJobs } from '@/lib/jobs/ActiveJobsProvider'
import BulkSendInvoicesPanel from '@/components/invoices/BulkSendInvoicesPanel'

const INK = 'var(--color-ink)'
const BODY = 'var(--color-neutral-800)'
const DIM = 'var(--color-neutral-500)'
const RULE_SOFT = '#d7d3d3'
const LEDGER = 'var(--color-ledger)'
const OCHRE = 'var(--color-ochre-text)'

export interface ClosePreview {
  hasOutstanding: boolean
  studentsWithOutstandingCount: number
  totalOutstanding: number
  futureInvoicesToUpdateCount: number
  futureInvoicesNeedingResendCount: number
  hasFutureTerm: boolean
  unnotifiedChangedCount: number
  invoicesLockedCount: number
  studentsWithCreditCount: number
  creditCarried: number
}

interface Props {
  cycle: CycleRow
  preview: ClosePreview
  showFinancials: boolean
  // Set when Cycles routed here because activating a draft would otherwise
  // close this term as an invisible side effect. Once this term is closed,
  // that draft is activated automatically — activateTerm finds no active
  // term left to close at that point, so it just activates, no double-close.
  activateAfter: { id: string; name: string } | null
}

function naira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

interface Row {
  what: string
  val: string
  ink: string
}

export default function CloseTermLedger({ cycle, preview, showFinancials, activateAfter }: Props) {
  const router = useRouter()
  const { trackJob } = useActiveJobs()
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activateError, setActivateError] = useState<string | null>(null)
  const [resendOpen, setResendOpen] = useState(false)
  const [result, setResult] = useState<{
    studentsWithCarryForward: number
    totalCarryForward: number
    invoicesUpdated: number
    invoicesNeedingResend: number
    activatedName: string | null
  } | null>(null)

  // Days-to-due, same computation the Cycles lifecycle uses. Closing a term
  // before its due date carries forward balances parents haven't had a chance
  // to pay — worth stating plainly, in ochre, above the ledger.
  const daysUntilDue = useMemo(() => {
    if (!cycle.dueDate) return null
    const due = new Date(cycle.dueDate)
    const today = new Date()
    due.setHours(0, 0, 0, 0)
    today.setHours(0, 0, 0, 0)
    return Math.round((due.getTime() - today.getTime()) / 86400000)
  }, [cycle.dueDate])

  const warn =
    daysUntilDue != null && daysUntilDue > 0
      ? `${cycle.name} is still ${daysUntilDue} ${daysUntilDue === 1 ? 'day' : 'days'} from its due date. Closing now carries forward balances that parents have not yet had the chance to pay.`
      : null

  const rows: Row[] = useMemo(() => {
    const p = preview
    const out: Row[] = []

    out.push({
      what: 'Invoices locked — no further edits',
      val: p.invoicesLockedCount.toLocaleString('en-NG'),
      ink: p.invoicesLockedCount > 0 ? INK : DIM,
    })

    out.push({
      what: 'Students whose balance carries forward',
      val: p.studentsWithOutstandingCount.toLocaleString('en-NG'),
      ink: p.studentsWithOutstandingCount > 0 ? OCHRE : DIM,
    })

    out.push({
      what: p.hasFutureTerm
        ? 'Money carried onto the next term'
        : 'Money carried forward (applied when a future term opens)',
      val: showFinancials
        ? naira(p.totalOutstanding)
        : cycle.totalExpected > 0
          ? `${Math.round((p.totalOutstanding / cycle.totalExpected) * 100)}% of expected`
          : '0%',
      ink: p.totalOutstanding > 0 ? OCHRE : DIM,
    })

    if (p.hasFutureTerm && p.futureInvoicesToUpdateCount > 0) {
      out.push({
        what: 'Future-term invoices updated with the carry-forward',
        val: p.futureInvoicesToUpdateCount.toLocaleString('en-NG'),
        ink: OCHRE,
      })
      if (p.futureInvoicesNeedingResendCount > 0) {
        out.push({
          what: 'Of those, already sent — need resending to parents',
          val: p.futureInvoicesNeedingResendCount.toLocaleString('en-NG'),
          ink: OCHRE,
        })
      }
    }

    out.push({
      what: 'Students with credit carried forward',
      val: p.studentsWithCreditCount.toLocaleString('en-NG'),
      ink: p.studentsWithCreditCount > 0 ? LEDGER : DIM,
    })

    if (showFinancials) {
      out.push({
        what: 'Credit carried',
        val: naira(p.creditCarried),
        ink: p.creditCarried > 0 ? LEDGER : DIM,
      })
    }

    return out
  }, [preview, showFinancials, cycle.totalExpected])

  async function handleClose() {
    setError(null)
    setActivateError(null)
    setClosing(true)
    const res = await closeTerm(cycle.id)
    if ('error' in res) {
      setClosing(false)
      setError(res.error)
      return
    }
    // Carry-forward can be handed to a background job; track it so the floating
    // chip shows live progress and a toast fires when it finishes.
    if (res.summary.jobId) {
      trackJob(
        res.summary.jobId,
        'close_term',
        'Carrying forward balances',
        { total: res.summary.invoicesUpdated },
        undefined,
        { href: '/fees/cycles' }
      )
    }

    // This term is closed. If Cycles sent us here to activate a draft
    // afterward, do that now — activateTerm will find no active term left
    // (we just closed it), so it activates directly with no second close.
    let activatedName: string | null = null
    if (activateAfter) {
      const activateRes = await activateTerm(activateAfter.id)
      if ('error' in activateRes) {
        setActivateError(activateRes.error || 'Something went wrong')
      } else {
        activatedName = activateAfter.name
      }
    }

    setClosing(false)
    setResult({
      studentsWithCarryForward: res.summary.studentsWithOutstanding,
      totalCarryForward: res.summary.totalOutstanding,
      invoicesUpdated: res.summary.invoicesUpdated,
      invoicesNeedingResend: res.summary.invoicesNeedingResend,
      activatedName,
    })
    router.refresh()
  }

  // ── After close: a flush-left result panel, no modal ──────────────────────
  if (result) {
    return (
      <div style={{ maxWidth: 880 }}>
        <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
          <h2 style={{ fontSize: 25, fontWeight: 800, margin: '0 0 6px', color: INK }}>
            {cycle.name} is closed{result.activatedName ? ` — ${result.activatedName} is now active` : ''}
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: BODY, margin: '0 0 8px', maxWidth: '72ch' }}>
            The term is locked and read-only. Every itemised move below has been recorded.
          </p>
          {activateError && (
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-signal-text)', margin: '8px 0 0', paddingLeft: 12, borderLeft: '3px solid var(--color-signal)', maxWidth: '72ch' }}>
              {cycle.name} closed, but {activateAfter?.name} could not be activated: {activateError}
            </p>
          )}

          <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 28, paddingTop: 18 }}>
            <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 14px', color: INK }}>What closing did</h3>

            <LedgerRow what="Students whose balance carried forward" val={result.studentsWithCarryForward.toLocaleString('en-NG')} ink={result.studentsWithCarryForward > 0 ? OCHRE : DIM} />
            {showFinancials && (
              <LedgerRow what="Money carried forward" val={naira(result.totalCarryForward)} ink={result.totalCarryForward > 0 ? OCHRE : DIM} />
            )}
            <LedgerRow what="Invoices updated with the carry-forward" val={result.invoicesUpdated.toLocaleString('en-NG')} ink={result.invoicesUpdated > 0 ? OCHRE : DIM} />
            {result.invoicesNeedingResend > 0 && (
              <LedgerRow what="Already sent — now need resending to parents" val={result.invoicesNeedingResend.toLocaleString('en-NG')} ink={OCHRE} />
            )}

            {result.studentsWithCarryForward > result.invoicesUpdated && (
              <p style={{ fontSize: 13, color: BODY, margin: '14px 0 0', maxWidth: '70ch', paddingLeft: 12, borderLeft: `2px solid ${RULE_SOFT}` }}>
                {result.studentsWithCarryForward - result.invoicesUpdated} students had no invoice yet in a future term. When one is generated for them, the carry-forward will be included automatically.
              </p>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22, alignItems: 'center' }}>
              {result.activatedName ? (
                <Link href={`/fees/cycles/${activateAfter?.id}`} className="m-btn m-btn-primary">View {result.activatedName}</Link>
              ) : (
                <Link href="/fees/cycles" className="m-btn m-btn-primary">Back to Cycles</Link>
              )}
              <Link href={`/fees/cycles/${cycle.id}`} className="m-btn m-btn-outline">View the closed term</Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Before close: the pre-run ledger ──────────────────────────────────────
  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 style={{ fontSize: 25, fontWeight: 800, margin: '0 0 6px', color: INK }}>Close {cycle.name}</h2>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: BODY, margin: '0 0 8px', maxWidth: '72ch' }}>
          Closing locks this term against further edits and moves every unpaid balance onto the next term&apos;s invoice.
          Nothing is written until you press the button below.
        </p>
        {activateAfter && (
          <p style={{ fontSize: 14, fontWeight: 600, color: INK, margin: '0 0 8px', maxWidth: '72ch' }}>
            Once this closes, {activateAfter.name} will be activated automatically.
          </p>
        )}
        {warn && (
          <p style={{ fontSize: 14, fontWeight: 600, color: OCHRE, margin: '0 0 8px', maxWidth: '72ch' }}>{warn}</p>
        )}

        {error && (
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-signal-text)', margin: '8px 0 0', paddingLeft: 12, borderLeft: '3px solid var(--color-signal)', maxWidth: '72ch' }}>
            {error}
          </p>
        )}

        <div style={{ borderTop: '2px solid var(--color-ink)', marginTop: 28, paddingTop: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: INK }}>What closing will do</h3>
          <p style={{ fontSize: 14, color: BODY, margin: '0 0 14px', maxWidth: '70ch' }}>
            Nothing has happened yet. This is what the button below will do, itemised, before you press it.
          </p>

          {rows.map((r, i) => (
            <LedgerRow key={i} what={r.what} val={r.val} ink={r.ink} />
          ))}

          {preview.unnotifiedChangedCount > 0 && (
            <div style={{ padding: '11px 0', borderTop: `1px solid ${RULE_SOFT}` }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 16, alignItems: 'baseline' }}>
                <span style={{ fontSize: 14, color: OCHRE }}>Changed since last sent — parents not yet told</span>
                <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: OCHRE }}>
                  {preview.unnotifiedChangedCount.toLocaleString('en-NG')}
                </span>
              </div>
              <p style={{ fontSize: 13, color: BODY, margin: '4px 0 0', maxWidth: '64ch' }}>
                Closing won&apos;t block on this, it&apos;s recorded either way. You can resend the changed invoices now.
              </p>
              <button onClick={() => setResendOpen(true)} className="m-btn m-btn-outline m-btn-sm" style={{ marginTop: 8 }}>
                Resend now
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22, alignItems: 'center' }}>
            <button onClick={handleClose} disabled={closing} className="m-btn m-btn-danger">
              {closing
                ? (activateAfter ? 'Closing and activating…' : 'Closing…')
                : (activateAfter ? `Close ${cycle.name} & activate ${activateAfter.name}` : `Close ${cycle.name}`)}
            </button>
            <Link href={`/fees/cycles/${cycle.id}`} className="m-btn m-btn-outline">See the unpaid list first</Link>
            <span style={{ fontSize: 13, color: OCHRE, fontWeight: 600 }}>Cannot be undone</span>
          </div>
        </div>
      </div>

      {resendOpen && (
        <BulkSendInvoicesPanel
          count={preview.unnotifiedChangedCount}
          onClose={() => { setResendOpen(false); router.refresh() }}
        />
      )}
    </div>
  )
}

function LedgerRow({ what, val, ink }: Row) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) auto',
        gap: 16,
        alignItems: 'baseline',
        padding: '11px 0',
        borderTop: `1px solid ${RULE_SOFT}`,
      }}
    >
      <span style={{ fontSize: 14, color: ink }}>{what}</span>
      <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: ink }}>{val}</span>
    </div>
  )
}
