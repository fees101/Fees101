'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createSchool } from './actions'

type Result = Awaited<ReturnType<typeof createSchool>>

const inputStyle: React.CSSProperties = {
  padding: '9px 11px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  color: 'var(--ink)',
  fontFamily: 'var(--font)',
  fontSize: 13.5,
  width: '100%',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--muted)',
  display: 'block',
  marginBottom: 6,
}

export default function OnboardingForm({ initialSchoolName = '', initialOwnerName = '', initialOwnerEmail = '' }: {
  initialSchoolName?: string
  initialOwnerName?: string
  initialOwnerEmail?: string
}) {
  const [schoolName, setSchoolName] = useState(initialSchoolName)
  const [ownerName, setOwnerName] = useState(initialOwnerName)
  const [ownerEmail, setOwnerEmail] = useState(initialOwnerEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await createSchool({ schoolName, ownerName, ownerEmail })
    setBusy(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setResult(res)
  }

  function handleAnother() {
    setSchoolName('')
    setOwnerName('')
    setOwnerEmail('')
    setResult(null)
    setCopied(false)
  }

  async function handleCopy(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail (permissions, non-secure context) — the link
      // is still selectable text in the box below, so this isn't fatal.
    }
  }

  if (result && 'success' in result) {
    return (
      <div className="panel" style={{ padding: '22px 18px', maxWidth: 640 }}>
        <div className="tag tag-good" style={{ marginBottom: 14 }}>School created</div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{result.schoolName}</p>
        <p style={{ margin: '4px 0 18px', fontSize: 13, color: 'var(--muted)' }}>
          Default roles are seeded. The owner login exists but is inactive until they set a password.
        </p>

        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
          No automated welcome email yet — copy this link and send it to {result.ownerEmail} yourself (email, WhatsApp, whatever). It expires in a few hours.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <input readOnly value={result.actionLink} style={{ ...inputStyle, color: 'var(--faint)', fontSize: 12 }} onFocus={(e) => e.target.select()} />
          <button className="btn btn-primary" style={{ flexShrink: 0 }} onClick={() => handleCopy(result.actionLink)}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={`/schools/${result.schoolId}`} className="btn btn-primary">View school</Link>
          <button className="btn" onClick={handleAnother}>Onboard another</button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ padding: '22px 18px', maxWidth: 480 }}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="schoolName">School name</label>
        <input id="schoolName" style={inputStyle} value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="e.g. Bright Minds Academy" required />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="ownerName">Owner&rsquo;s name</label>
        <input id="ownerName" style={inputStyle} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Mrs Adeyemi" required />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle} htmlFor="ownerEmail">Owner&rsquo;s email</label>
        <input id="ownerEmail" type="email" style={inputStyle} value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@school.com" required />
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--bad)', marginBottom: 14 }}>{error}</p>}

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create school'}
      </button>
    </form>
  )
}
