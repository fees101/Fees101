'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendManualReminder } from '@/app/(app)/students/[id]/actions'
import { MessageChannel } from '@/lib/messaging/types'

const CHANNEL_LABELS: Record<MessageChannel, string> = {
  sms: 'SMS',
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

export default function SendReminderButton({ studentId }: { studentId: string }) {
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

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleSend}
        disabled={sending}
        className="px-4 py-2 border border-mint text-mint rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-mint-light disabled:opacity-50"
        title="Sends via SMS"
      >
        <ChannelIcons />
        {sending ? 'Sending…' : 'Send reminder'}
      </button>
      {result && (
        <p className={`text-xs ${result.ok ? 'text-mint' : 'text-red-600'}`}>{result.message}</p>
      )}
    </div>
  )
}
