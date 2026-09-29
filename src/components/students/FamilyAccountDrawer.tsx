'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { FamilyAccountRow } from '@/lib/queries/families'
import { getFamilyChildren, type FamilyChildRow } from '@/app/(app)/students/family-accounts/actions'
import { toggleFamilyDva } from '@/app/(app)/students/[id]/actions'

interface Props {
  family: FamilyAccountRow
  canManage: boolean
  onClose: () => void
}

function familyLabel(f: FamilyAccountRow): string {
  return f.primaryParentName || 'Unnamed family'
}

// Per-row detail panel for the Family accounts page (Phase 7). Replaces a
// bare inline "Turn on/off" button: staff see who's in the family before
// acting, and turning an account on or off both happen from here rather than
// a single blind click on the list row. Bulk turn on/off (FamilyAccountsTable's
// selection bar) stays a plain confirm — this drawer is for the single-family,
// look-before-you-act case.
export default function FamilyAccountDrawer({ family, canManage, onClose }: Props) {
  const router = useRouter()
  const [live, setLive] = useState(family)
  const [children, setChildren] = useState<FamilyChildRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmingOff, setConfirmingOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setLive(family)
    setConfirmingOff(false)
    setActionError(null)
    setChildren(null)
    setLoadError(null)
    let cancelled = false
    getFamilyChildren(family.id).then(result => {
      if (cancelled) return
      if ('error' in result) setLoadError(result.error)
      else setChildren(result.children)
    })
    return () => { cancelled = true }
  }, [family])

  async function handleTurnOn() {
    setBusy(true)
    setActionError(null)
    const result = await toggleFamilyDva(live.id, true)
    setBusy(false)
    if ('error' in result) { setActionError(result.error); return }
    setLive({
      ...live,
      dvaEnabled: true,
      accountNumber: 'accountNumber' in result ? result.accountNumber ?? null : live.accountNumber,
      bankName: 'bankName' in result ? result.bankName ?? null : live.bankName,
    })
    router.refresh()
  }

  async function handleTurnOff() {
    setBusy(true)
    setActionError(null)
    const result = await toggleFamilyDva(live.id, false)
    setBusy(false)
    if ('error' in result) { setActionError(result.error); return }
    setConfirmingOff(false)
    setLive({ ...live, dvaEnabled: false, accountNumber: null, bankName: null })
    router.refresh()
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 m-anim-fade" style={{ zIndex: 60, background: 'color-mix(in srgb, var(--color-ink) 45%, transparent)' }} />
      <div
        className="fixed top-0 right-0 bottom-0 bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] overflow-y-auto"
        style={{ zIndex: 61, width: 'min(420px, 100vw)' }}
      >
        <div className="p-6 border-b-2 border-[var(--color-ink)] flex items-start justify-between gap-3">
          <div style={{ minWidth: 0 }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)] mb-1">Family account</p>
            <h3 className="text-xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]">{familyLabel(live)}</h3>
            <p className="m-num text-[13px] text-[var(--color-neutral-700)] mt-0.5">{live.primaryParentPhone || '—'}</p>
          </div>
          <button onClick={onClose} className="text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] whitespace-nowrap">Close</button>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-[var(--color-neutral-300)]">
            <span className="text-[12px] font-semibold tracking-[0.06em]" style={{ color: live.dvaEnabled ? 'var(--color-ledger)' : 'var(--color-neutral-500)' }}>
              {live.dvaEnabled ? 'ACCOUNT ON' : 'ACCOUNT OFF'}
            </span>
            {live.dvaEnabled && live.accountNumber && (
              <span className="m-num text-[13px] text-[var(--color-ink)]">{live.accountNumber} &middot; {live.bankName}</span>
            )}
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-700)] mb-2">
            Children ({live.childCount})
          </p>
          {loadError && <p className="text-[13px] text-[var(--color-signal-text)] mb-6">{loadError}</p>}
          {!children && !loadError && <p className="text-[13px] text-[var(--color-neutral-700)] mb-6">Loading...</p>}
          {children && (
            <ul className="mb-6">
              {children.map(c => (
                <li key={c.id} className="flex items-center justify-between py-1.5 border-b border-[var(--color-neutral-300)] text-[14px]">
                  <span className="text-[var(--color-ink)]">{c.firstName} {c.lastName}</span>
                  <span className="text-[var(--color-neutral-700)]">{c.className}</span>
                </li>
              ))}
            </ul>
          )}

          {actionError && (
            <div className="mb-4 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
              {actionError}
            </div>
          )}

          {!canManage && (
            <p className="text-[13px] text-[var(--color-neutral-700)]">You don&apos;t have permission to change this account.</p>
          )}

          {canManage && !live.dvaEnabled && (
            <button onClick={handleTurnOn} disabled={busy} className="m-btn m-btn-primary m-btn-sm w-full">
              {busy ? 'Creating...' : 'Turn on shared account'}
            </button>
          )}

          {canManage && live.dvaEnabled && !confirmingOff && (
            <button onClick={() => setConfirmingOff(true)} disabled={busy} className="m-btn m-btn-outline m-btn-sm w-full">
              Turn off shared account
            </button>
          )}

          {confirmingOff && (
            <div className="border-2 border-[var(--color-ink)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-signal-text)' }}>
                This closes the account
              </p>
              <p className="text-[13px] text-[var(--color-neutral-800)] mb-4">
                It stops accepting transfers at the bank immediately. Turning it back on later creates a new account with a different number — this one doesn&apos;t come back.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmingOff(false)} disabled={busy} className="m-btn m-btn-outline m-btn-sm flex-1">Cancel</button>
                <button onClick={handleTurnOff} disabled={busy} className="m-btn m-btn-danger m-btn-sm flex-1">{busy ? 'Closing...' : 'Turn off'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
