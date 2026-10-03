'use client'

import { useState } from 'react'
import { startImpersonation } from './actions'

export default function ImpersonateButton({ schoolId }: { schoolId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    const res = await startImpersonation(schoolId)
    setBusy(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    // The admin's own magic link — opening it in a new tab leaves this
    // console tab where it is, so they can jump straight back to end the
    // session or move to another school.
    window.open(res.actionLink, '_blank', 'noopener')
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={handleClick} disabled={busy}>
        {busy ? 'Starting…' : 'View as this school (read-only)'}
      </button>
      {error && <p style={{ fontSize: 12.5, color: 'var(--bad)', marginTop: 10 }}>{error}</p>}
    </div>
  )
}
