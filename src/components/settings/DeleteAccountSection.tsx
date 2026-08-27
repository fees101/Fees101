'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ExportAllDataButton from './ExportAllDataButton'
import { requestAccountDeletion } from '@/app/(app)/settings/data-privacy/actions'
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

  // ---- Already scheduled: read-only state ----
  if (scheduledFor) {
    return (
      <section className="bg-white border border-red-200 rounded-xl p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-red-700">Account scheduled for deletion</h2>
        <p className="mt-2 text-sm text-gray-600">
          This account is scheduled to be permanently deleted on{' '}
          <span className="font-semibold text-navy">{formatDeletionDate(scheduledFor)}</span>. All staff
          sign-in has been disabled. To cancel and restore access, contact us at{' '}
          <a href={`mailto:${contactEmail}`} className="text-navy font-medium underline">
            {contactEmail}
          </a>{' '}
          before that date.
        </p>
      </section>
    )
  }

  return (
    <section className="bg-white border border-red-200 rounded-xl p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-red-700">Close account &amp; delete data</h2>
      <p className="mt-1 text-sm text-gray-500">
        Permanently close this account and delete your school&apos;s data.
      </p>
      <p className="mt-3 text-sm text-gray-600">
        This deactivates every staff login immediately and schedules your data for permanent deletion
        after a {graceDays}-day grace period. Within that window you can contact us to cancel. After it,
        personal data is erased for good — financial records are kept anonymised for {retentionYears} years
        for tax/audit, then deleted too. <span className="font-medium text-navy">Export your data first</span>{' '}
        if you might need it — the grace window, not the export file, is how an account is restored.
      </p>

      <button
        onClick={() => {
          setOpen(true)
          setError(null)
        }}
        className="mt-4 inline-flex items-center justify-center rounded-lg text-sm font-semibold py-2 px-3.5 border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
      >
        Delete my school&apos;s data
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            {done ? (
              // ---- Final confirmation, then redirect to login ----
              <div className="p-6">
                <h3 className="text-base font-semibold text-navy mb-2">Account closed</h3>
                <p className="text-sm text-gray-600">
                  Your account has been closed and your data is scheduled for permanent deletion
                  {done ? (
                    <>
                      {' '}on <span className="font-semibold text-navy">{formatDeletionDate(done)}</span>
                    </>
                  ) : null}
                  . You&apos;ve been signed out. To cancel before then, contact{' '}
                  <a href={`mailto:${contactEmail}`} className="text-navy font-medium underline">
                    {contactEmail}
                  </a>
                  .
                </p>
                <p className="mt-3 text-xs text-gray-400">Taking you to the sign-in screen…</p>
              </div>
            ) : (
              <>
                <div className="p-6">
                  <h3 className="text-base font-semibold text-red-700 mb-2">
                    Delete {schoolName}&apos;s data?
                  </h3>
                  <p className="text-sm text-gray-600">
                    This closes the account for everyone and permanently deletes your data after{' '}
                    {graceDays} days. This can only be undone by contacting us during the grace period.
                  </p>

                  {/* Step 1 — export first */}
                  <div className="mt-4 rounded-lg border border-gray-200 p-3">
                    <p className="text-xs font-medium text-navy">1. Download your data first (recommended)</p>
                    <p className="text-xs text-gray-500 mt-1 mb-2">
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
                    <span className="text-sm text-gray-700">{DELETION_ACKNOWLEDGEMENT}</span>
                  </label>

                  {/* Step 3 — type the name */}
                  <div className="mt-4">
                    <label className="text-xs font-medium text-navy">
                      2. Type your school name to confirm:{' '}
                      <span className="font-semibold">{schoolName}</span>
                    </label>
                    <input
                      type="text"
                      value={confirmName}
                      onChange={e => setConfirmName(e.target.value)}
                      placeholder={schoolName}
                      autoComplete="off"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                    />
                  </div>

                  {error && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      {error}
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirm}
                    disabled={!canConfirm}
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {submitting ? 'Closing account…' : 'Permanently delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
