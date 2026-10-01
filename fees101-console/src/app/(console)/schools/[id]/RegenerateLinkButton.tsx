'use client'

import { useState } from 'react'
import { regenerateOwnerLink } from './actions'

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

export default function RegenerateLinkButton({ schoolId }: { schoolId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleRegenerate() {
    setBusy(true)
    setError(null)
    setLink(null)
    setNote(null)
    const res = await regenerateOwnerLink(schoolId)
    setBusy(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    if ('alreadyActive' in res) {
      setNote('This owner has already activated their account and can log in normally.')
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
          Fresh activation link. Send it to the owner yourself. It works once and expires after a few hours.
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

  return (
    <div>
      <button className="btn btn-primary" onClick={handleRegenerate} disabled={busy}>
        {busy ? 'Generating…' : 'Regenerate activation link'}
      </button>
      {error && <p style={{ fontSize: 12.5, color: 'var(--bad)', marginTop: 10 }}>{error}</p>}
      {note && <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>{note}</p>}
    </div>
  )
}
