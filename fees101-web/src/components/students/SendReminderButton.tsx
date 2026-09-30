'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendManualReminder } from '@/app/(app)/students/[id]/actions'
import { MessageChannel } from '@/lib/messaging/types'
import Toast from '@/components/ui/Toast'
import { useCan } from '@/lib/auth/PermissionsProvider'

const CHANNEL_LABELS: Record<MessageChannel, string> = {
  sms: 'SMS',
  email: 'Email',
}

export default function SendReminderButton({
  studentId,
  needsResend,
  sentAt,
  status,
}: {
  studentId: string
  needsResend?: boolean
  sentAt?: string | null
  status?: string
}) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const canManageStudents = useCan('manage-students')
  const canManageInvoices = useCan('manage-invoices')

  async function handleSend() {
    setSending(true)
    setResult(null)
    const r = await sendManualReminder(studentId)
    setSending(false)
    if ('error' in r) { setResult({ ok: false, message: r.error }); return }
    setResult({ ok: true, message: `Sent to ${r.to} via ${r.channelUsed ? CHANNEL_LABELS[r.channelUsed] : 'unknown channel'}` })
    router.refresh()
  }

  // Stale invoices are never sendable, by anyone, until regenerated — the SMS
  // pulls its balance straight off the invoice row, so sending it here would
  // text the parent an outdated amount.
  if (needsResend) {
    return (
      <span
        className="text-xs font-semibold uppercase"
        style={{ color: 'var(--color-ochre-text)', letterSpacing: '0.08em' }}
        title="The invoice changed since it was last sent — update it before sending again"
      >
        Needs resend
      </span>
    )
  }

  // Sending an invoice for the first time is part of "generate & send
  // invoices" — gated the same as generating/regenerating it. But the server
  // action (sendManualReminder) reaches that check only after its outer
  // getStudentFeeContext() gate, which requires manage-students on every call
  // regardless of first-send or not. So a first send actually needs BOTH
  // permissions — matching client-side to just manage-invoices let a
  // manage-invoices-only holder (no manage-students) see an enabled button
  // that failed server-side on every click. A reminder or receipt nudge about
  // an invoice already sent stays under manage-students alone, whose scope
  // explicitly covers ad-hoc reminders.
  const isFirstSend = !sentAt && status !== 'paid'
  const canSend = isFirstSend ? (canManageInvoices && canManageStudents) : canManageStudents

  const label = status === 'paid'
    ? 'Send receipt'
    : !sentAt
    ? 'Send invoice'
    : 'Send reminder'

  if (!canSend) return null

  return (
    <>
      <button
        onClick={handleSend}
        disabled={sending}
        className="m-btn m-btn-primary w-full"
        title="Sends via SMS"
      >
        {sending ? 'Sending…' : label}
      </button>
      {result && (
        <Toast message={result.message} ok={result.ok} onDismiss={() => setResult(null)} />
      )}
    </>
  )
}
