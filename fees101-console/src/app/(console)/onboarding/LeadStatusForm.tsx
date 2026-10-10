'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateAccessRequestStatus } from './actions'

const NEXT_STATUS: Record<string, string> = {
  new: 'contacted',
  contacted: 'converted',
}

// Inline status-cycle control for one lead row — closes the "leads list is
// read-only forever" gap (2026-10-10). Deliberately a single "advance" button
// rather than a free-form dropdown for the common path (new → contacted →
// converted), plus a "Decline" escape hatch, so moving a lead along is a
// one-click action most of the time rather than a form to fill in.
export default function LeadStatusForm({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function setStatus(next: string) {
    setBusy(true)
    const result = await updateAccessRequestStatus(id, next)
    setBusy(false)
    if (!('error' in result)) router.refresh()
  }

  const next = NEXT_STATUS[status]

  if (status === 'converted' || status === 'declined') {
    return <span style={{ color: 'var(--faint)', fontSize: 12 }}>—</span>
  }

  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      {next && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus(next)}>
          Mark {next}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('declined')} style={{ color: 'var(--bad-text)' }}>
        Decline
      </button>
    </div>
  )
}
