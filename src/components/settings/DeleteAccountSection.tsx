'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ExportAllDataButton from './ExportAllDataButton'
import { requestAccountDeletion } from '@/app/(app)/team/data-privacy/actions'
import { DELETION_ACKNOWLEDGEMENT, formatDeletionDate } from '@/lib/dataPrivacy/config'

interface Props {
  schoolName: string
  graceDays: number
  retentionYears: number
  contactEmail: string
  /** If a deletion is already scheduled, show that state instead of the button. */
  scheduledFor?: string | null
}

// Owner-only "close account & delete data" flow. Prompts the owner to export
// first, requires an explicit acknowledgement, and a type-the-school-name
// confirm before scheduling deletion. On success the account closes immediately
// and the owner is signed out (→ login screen shows the scheduled state).
export default function DeleteAccountSection({
  schoolName,
  graceDays,
  retentionYears,
  contactEmail,
  scheduledFor,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const nameMatches = confirmName.trim().toLowerCase() === schoolName.trim().toLowerCase()
  const canConfirm = acknowledged && nameMatches && !submitting

  async function confirm() {
    setSubmitting(true)
    setError(null)
    const res = await requestAccountDeletion({ confirmName, acknowledged })
    if (res?.error) {
      setError(res.error)
      setSubmitting(false)
      return
    }
    // Account is now closed and the session signed out. Show the final state,
    // then send them to the login screen.
    setDone(res?.scheduledFor ?? null)
    setTimeout(() => router.push('/login?error=scheduled_deletion'), 4000)
  }

  // ---- Already scheduled: read-only ledger row ----
  if (scheduledFor) {
    return (
      <div className="m-setrow">
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>Close this school</p>
          <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
            All staff sign-in is disabled. To cancel and restore access, contact{' '}
            <a href={`mailto:${contactEmail}`} className="text-[var(--color-ink)] font-medium underline">{contactEmail}</a>{' '}
            before the date below.
          </p>
        </div>
        <div className="m-setrow__side">
          <p className="text-[15px] font-semibold m-num" style={{ margin: 0, color: 'var(--color-signal-text)' }}>
            Deletes {formatDeletionDate(scheduledFor)}
          </p>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>FIXED</span>
        </div>
      </div>
    )
  }

  return (
    <div className="m-setrow">
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>Close this school</p>
        <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>
          Schedules deletion of everything after a {graceDays}-day grace period. Deactivates every staff login
          immediately; only cancellable within the window by contacting us.
        </p>
      </div>
      <div className="m-setrow__side">
        <p className="text-[15px]" style={{ margin: 0, color: 'var(--color-neutral-500)' }}>Not scheduled</p>
        <button
          onClick={() => {
            setOpen(true)
            setError(null)
          }}
          style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-signal-text)', whiteSpace: 'nowrap' }}
          className="hover:text-[var(--color-signal)]"
        >
          REQUEST
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 bg-[color-mix(in_srgb,var(--color-ink)_55%,transparent)] z-[70] flex items-center justify-center p-4 m-anim-fade">
          <div className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-md w-full max-h-[90vh] overflow-y-auto m-anim-scale">
            {done ? (
              // ---- Final confirmation, then redirect to login ----
              <div className="p-6">
                <h3 className="text-base font-extrabold text-[var(--color-ink)] mb-2">Account closed</h3>
                <p className="text-sm text-[var(--color-neutral-700)]">
                  Your account has been closed and your data is scheduled for permanent deletion
                  {done ? (
                    <>
                      {' '}on <span className="font-semibold text-[var(--color-ink)] m-num">{formatDeletionDate(done)}</span>
                    </>
                  ) : null}
                  . You&apos;ve been signed out. To cancel before then, contact{' '}
                  <a href={`mailto:${contactEmail}`} className="text-[var(--color-ink)] font-medium underline">
                    {contactEmail}
                  </a>
                  .
                </p>
                <p className="mt-3 text-xs text-[var(--color-neutral-500)]">Taking you to the sign-in screen...</p>
              </div>
            ) : (
              <>
                <div className="p-6">
                  <h3 className="text-base font-extrabold text-[var(--color-signal-text)] mb-2">
                    Delete {schoolName}&apos;s data?
                  </h3>
                  <p className="text-sm text-[var(--color-neutral-700)]">
                    This closes the account for everyone and permanently deletes your data after{' '}
                    {graceDays} days. This can only be undone by contacting us during the grace period.
                  </p>

                  {/* Step 1 — export first */}
                  <div className="mt-4 border border-[var(--color-neutral-300)] p-3">
                    <p className="text-xs font-medium text-[var(--color-ink)]">1. Download your data first (recommended)</p>
                    <p className="text-xs text-[var(--color-neutral-700)] mt-1 mb-2">
                      Take a copy before it&apos;s gone. The export can&apos;t restore the account — it&apos;s
                      for your records.
                    </p>
                    <ExportAllDataButton />
                  </div>

                  {/* Step 2 — acknowledge */}
                  <label className="mt-4 flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={e => setAcknowledged(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-[var(--color-neutral-700)]">{DELETION_ACKNOWLEDGEMENT}</span>
                  </label>

                  {/* Step 3 — type the name */}
                  <div className="mt-4">
                    <label className="m-label">
                      2. Type your school name to confirm: <span className="font-semibold text-[var(--color-ink)]">{schoolName}</span>
                    </label>
                    <input
                      type="text"
                      value={confirmName}
                      onChange={e => setConfirmName(e.target.value)}
                      placeholder={schoolName}
                      autoComplete="off"
                      className="m-input"
                    />
                  </div>

                  {error && (
                    <div className="mt-3 p-3 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
                      {error}
                    </div>
                  )}
                </div>

                <div className="p-4 border-t-2 border-[var(--color-ink)] flex items-center justify-end gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="m-btn m-btn-outline m-btn-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirm}
                    disabled={!canConfirm}
                    className="m-btn m-btn-danger m-btn-sm"
                  >
                    {submitting ? 'Closing account...' : 'Permanently delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
