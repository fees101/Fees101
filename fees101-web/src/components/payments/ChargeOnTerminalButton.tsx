'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCan } from '@/lib/auth/PermissionsProvider'
import {
  listTerminalsForCharge,
  chargeOnTerminal,
  pollTerminalCharge,
  type TerminalForCharge,
} from '@/app/(app)/terminal-actions'

interface Props {
  studentId: string
  studentName: string
  // The invoice the charge is anchored to (null = a general student charge).
  invoiceId: string | null
  // Default/cap amount — the invoice's outstanding.
  outstanding: number
  // Visual size to match the host row. 'sm' matches the inline fee-tab buttons.
  size?: 'sm' | 'md'
  // Overrides the trigger button's classes (e.g. the full-width invoice column).
  triggerClassName?: string
}

type Phase = 'idle' | 'form' | 'waiting' | 'paid' | 'failed'

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

// "Charge on terminal" — pushes an in-person card/USSD/transfer charge to one of
// the school's Paystack Terminals and watches it complete. Renders nothing when
// the user can't charge or the school has no registered terminal, so it only
// appears where it's actually usable.
export default function ChargeOnTerminalButton({ studentId, studentName, invoiceId, outstanding, size = 'sm', triggerClassName }: Props) {
  const router = useRouter()
  const canCharge = useCan('charge-on-terminal')

  const [terminals, setTerminals] = useState<TerminalForCharge[] | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [terminalId, setTerminalId] = useState<string>('')
  // String-backed so the field can be fully cleared (no un-deletable 0).
  const [amountInput, setAmountInput] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [deviceLabel, setDeviceLabel] = useState<string>('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartRef = useRef<number>(0)

  // Load the school's terminals once, only if the user can charge. An empty list
  // (non-Paystack school, or no device registered) hides the button entirely.
  useEffect(() => {
    if (!canCharge) return
    let active = true
    listTerminalsForCharge()
      .then((list) => {
        if (active) setTerminals(list)
      })
      .catch(() => {
        if (active) setTerminals([])
      })
    return () => {
      active = false
    }
  }, [canCharge])

  // Clean up the poll on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  if (!canCharge || !terminals || terminals.length === 0) return null

  function openForm() {
    setError(null)
    setAmountInput(outstanding > 0 ? String(outstanding) : '')
    setTerminalId(terminals && terminals.length > 0 ? terminals[0].terminalId : '')
    setPhase('form')
  }

  function closeAll() {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    setPhase('idle')
    setError(null)
    setSending(false)
    setRequestId(null)
  }

  function startPolling(id: string) {
    pollStartRef.current = Date.now()
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      // Stop after 10 minutes — the expiry sweep will mark the row expired too.
      if (Date.now() - pollStartRef.current > 10 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        setError('No payment came through in time. You can try again.')
        setPhase('failed')
        return
      }
      const status = await pollTerminalCharge(id).catch(() => null)
      if (!status) return
      if (status.status === 'paid') {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        setPhase('paid')
        router.refresh()
      } else if (status.status === 'failed' || status.status === 'expired') {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        setError(status.errorMessage || 'The payment did not go through on the terminal.')
        setPhase('failed')
      }
    }, 3000)
  }

  async function handleSend() {
    setError(null)
    const amount = Number(amountInput)
    if (!(amount > 0)) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (!terminalId) {
      setError('Choose a terminal.')
      return
    }
    setSending(true)
    const device = terminals?.find((t) => t.terminalId === terminalId)
    setDeviceLabel(device?.label || 'the terminal')
    const result = await chargeOnTerminal({ studentId, invoiceId, terminalId, amount }).catch(() => null)
    setSending(false)
    if (!result || !result.ok || !result.requestId) {
      setError(result?.error || 'Could not reach the terminal. Please try again.')
      setPhase('failed')
      return
    }
    setRequestId(result.requestId)
    setPhase('waiting')
    startPolling(result.requestId)
  }

  const btnClass = triggerClassName || (size === 'sm' ? 'm-btn m-btn-outline m-btn-sm' : 'm-btn m-btn-outline')

  return (
    <>
      <button onClick={openForm} className={btnClass} type="button">
        Charge on terminal
      </button>

      {phase !== 'idle' && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
          <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-sm w-full m-anim-scale">
            <div className="p-6">
              <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)] mb-1">
                Charge on terminal
              </h3>
              <p className="text-sm text-[var(--color-neutral-700)] mb-4">{studentName}</p>

              {phase === 'form' && (
                <div className="space-y-4">
                  {terminals.length > 1 && (
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-neutral-700)] mb-1">
                        Terminal
                      </label>
                      <select
                        value={terminalId}
                        onChange={(e) => setTerminalId(e.target.value)}
                        className="m-select w-full"
                      >
                        {terminals.map((t) => (
                          <option key={t.terminalId} value={t.terminalId}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.06em] text-[var(--color-neutral-700)] mb-1">
                      Amount
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value.replace(/[^\d.]/g, ''))}
                      className="m-input w-full m-num"
                      placeholder="0"
                    />
                    {outstanding > 0 && (
                      <p className="text-xs text-[var(--color-neutral-700)] mt-1">
                        Outstanding: {formatNaira(outstanding)}. More than this is capped to what&apos;s owed.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {phase === 'waiting' && (
                <div className="py-2">
                  <p className="text-sm text-[var(--color-ink)] m-num">
                    Sent to {deviceLabel}. Hand the parent the terminal — they can pay by card, USSD or transfer.
                  </p>
                  <p className="text-sm text-[var(--color-neutral-700)] mt-3">Waiting for payment…</p>
                </div>
              )}

              {phase === 'paid' && (
                <div className="py-2">
                  <p className="text-sm font-semibold text-[var(--color-ledger)]">Paid. Receipt sent.</p>
                  <p className="text-sm text-[var(--color-neutral-700)] mt-2">
                    The payment has been recorded against {studentName}&apos;s account automatically.
                  </p>
                </div>
              )}

              {(error || phase === 'failed') && (
                <div className="mt-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
                  {error || 'The payment did not go through.'}
                </div>
              )}
            </div>

            <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
              {phase === 'form' && (
                <>
                  <button onClick={closeAll} disabled={sending} className="m-btn m-btn-outline m-btn-sm" type="button">
                    Cancel
                  </button>
                  <button onClick={handleSend} disabled={sending} className="m-btn m-btn-primary m-btn-sm" type="button">
                    {sending ? 'Sending…' : 'Send to terminal'}
                  </button>
                </>
              )}
              {phase === 'waiting' && (
                <button onClick={closeAll} className="m-btn m-btn-outline m-btn-sm" type="button">
                  Close (keeps charging)
                </button>
              )}
              {phase === 'paid' && (
                <button onClick={closeAll} className="m-btn m-btn-primary m-btn-sm" type="button">
                  Done
                </button>
              )}
              {phase === 'failed' && (
                <>
                  <button onClick={closeAll} className="m-btn m-btn-outline m-btn-sm" type="button">
                    Close
                  </button>
                  <button onClick={() => setPhase('form')} className="m-btn m-btn-primary m-btn-sm" type="button">
                    Try again
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
