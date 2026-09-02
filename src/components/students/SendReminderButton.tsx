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

function ChannelIcons() {
  return (
    <span className="flex items-center gap-1 text-mint/70" title="Sends via SMS">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8-1.436 0-2.795-.29-4.001-.804L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </span>
  )
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
        className="px-4 py-2 rounded-lg text-sm font-medium border border-amber-500 text-amber-700 bg-amber-50"
        title="The invoice changed since it was last sent — update it before sending again"
      >
        Needs resend
      </span>
    )
  }

  // Sending an invoice for the first time is part of "generate & send
  // invoices" — gated the same as generating/regenerating it. A reminder or
  // receipt nudge about an invoice already sent stays under manage-students,
  // whose scope explicitly covers ad-hoc reminders.
  const isFirstSend = !sentAt && status !== 'paid'
  const canSend = isFirstSend ? canManageInvoices : canManageStudents

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
        className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 border border-mint text-mint hover:bg-mint-light"
        title="Sends via SMS"
      >
        <ChannelIcons />
        {sending ? 'Sending…' : label}
      </button>
      {result && (
        <Toast message={result.message} ok={result.ok} onDismiss={() => setResult(null)} />
      )}
    </>
  )
}
