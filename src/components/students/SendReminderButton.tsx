'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendManualReminder } from '@/app/(app)/students/[id]/actions'
import { MessageChannel } from '@/lib/messaging/types'
import Toast from '@/components/ui/Toast'

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

  async function handleSend() {
    setSending(true)
    setResult(null)
    const r = await sendManualReminder(studentId)
    setSending(false)
    if ('error' in r) { setResult({ ok: false, message: r.error }); return }
    setResult({ ok: true, message: `Sent to ${r.to} via ${r.channelUsed ? CHANNEL_LABELS[r.channelUsed] : 'unknown channel'}` })
    router.refresh()
  }

  // Needs-resend always wins — the parent's last copy is stale regardless of
  // payment status. Paid wins next — nothing is owed, so there's nothing to
  // invoice or remind about, even if never sent (e.g. a 100%-discounted
  // invoice). Otherwise the label reflects what the parent still needs: the
  // invoice itself if they've never been sent one, or a nudge while a
  // balance remains.
  const label = needsResend
    ? 'Needs resend'
    : status === 'paid'
    ? 'Send receipt'
    : !sentAt
    ? 'Send invoice'
    : 'Send reminder'

  return (
    <>
      <button
        onClick={handleSend}
        disabled={sending}
        className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 ${
          needsResend
            ? 'border border-amber-500 text-amber-700 bg-amber-50 hover:bg-amber-100'
            : 'border border-mint text-mint hover:bg-mint-light'
        }`}
        title={needsResend ? 'The invoice changed since it was last sent — resend to update the parent' : 'Sends via SMS'}
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
