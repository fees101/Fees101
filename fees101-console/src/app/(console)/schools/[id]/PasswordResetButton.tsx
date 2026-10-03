'use client'

import { useState } from 'react'
import { sendOwnerPasswordReset } from './actions'

const inputStyle: React.CSSProperties = {
  padding: '9px 11px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  color: 'var(--faint)',
  fontFamily: 'var(--font)',
  fontSize: 12,
  width: '100%',
}

export default function PasswordResetButton({ schoolId }: { schoolId: string }) {
  const [open, setOpen] = useState(false)
  const [requestedBy, setRequestedBy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSend() {
    setBusy(true)
    setError(null)
    const res = await sendOwnerPasswordReset(schoolId, requestedBy)
    setBusy(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setLink(res.actionLink)
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can fail (permissions/non-secure context) — the link is
      // still selectable text in the box, so this isn't fatal.
    }
  }

  if (link) {
    return (
      <div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
          Password reset link. Send it to the owner yourself. It works once and expires after a few hours.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={link} style={inputStyle} onFocus={(e) => e.target.select()} />
          <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={() => handleCopy(link)}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Send password reset
      </button>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
        Who asked for this? (e.g. &ldquo;owner called support, locked out&rdquo;)
      </p>
      <textarea
        value={requestedBy}
        onChange={(e) => setRequestedBy(e.target.value)}
        rows={2}
        style={{ ...inputStyle, resize: 'vertical', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={handleSend} disabled={busy || !requestedBy.trim()}>
          {busy ? 'Sending…' : 'Generate reset link'}
        </button>
        <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p style={{ fontSize: 12.5, color: 'var(--bad)', marginTop: 10 }}>{error}</p>}
    </div>
  )
}
