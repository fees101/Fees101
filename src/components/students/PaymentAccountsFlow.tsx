'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { startBulkDVAJob } from '@/app/(app)/students/[id]/actions'
import { useActiveJobs, useTrackedJob, useOnJobOpenRequested, type TrackedJob } from '@/lib/jobs/ActiveJobsProvider'
import { LedgerStep, type StepStatus } from './LedgerStep'

const PROVIDER_LABEL: Record<string, string> = {
  monnify: 'Monnify',
  paystack: 'Paystack',
}

// Provisioning surface: a four-step ledger showing how far every student is from
// having a virtual account to pay into. Steps 01-03 are driven entirely by the
// existing getPaymentSettings counts and the existing bulk_dva provisioning job
// (startBulkDVAJob). Step 04 is presentational — there is no standalone bulk
// "send account details" action yet, so it describes what that step will do
// without claiming to run it.
export default function PaymentAccountsFlow({
  provider, isConfigured, dvaCount, studentsWithoutDvaCount,
}: {
  provider: string | null
  isConfigured: boolean
  dvaCount: number
  studentsWithoutDvaCount: number
}) {
  const router = useRouter()
  const { trackJob, findRunningJob, cancelJob } = useActiveJobs()
  const existingJob = findRunningJob(j => j.jobType === 'bulk_dva')
  const [jobId, setJobId] = useState<string | null>(existingJob?.jobId ?? null)
  const job = useTrackedJob(jobId)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [createdCount, setCreatedCount] = useState<number | null>(null)
  useOnJobOpenRequested(existingJob?.jobId, () => {})

  const running = job?.status === 'running'
  const justFinished = createdCount !== null

  async function handleProvision() {
    setError(null)
    setStarting(true)
    const start = await startBulkDVAJob()
    setStarting(false)
    if ('error' in start) {
      setError(start.error ?? 'Could not start provisioning')
      return
    }
    if (!start.jobId) {
      // Nothing to create — refresh so the counts settle.
      router.refresh()
      return
    }
    setJobId(start.jobId)
    trackJob(start.jobId, 'bulk_dva', 'Creating payment accounts', {
      processed: start.processed,
      total: start.total,
    }, (finished: TrackedJob) => {
      setCreatedCount(finished.status === 'failed' ? 0 : finished.processed)
      if (finished.status === 'failed') setError(finished.error || 'Provisioning failed')
      router.refresh()
    }, { href: '/students/payment-accounts' })
  }

  const providerLabel = provider ? (PROVIDER_LABEL[provider] ?? provider) : null
  const total = dvaCount + studentsWithoutDvaCount

  // ── Step statuses ─────────────────────────────────────────────────────────
  const s1: StepStatus = isConfigured ? 'done' : 'notrun'
  const s2: StepStatus = !isConfigured ? 'notrun' : studentsWithoutDvaCount > 0 ? 'attention' : 'done'
  const s3: StepStatus = running ? 'running' : (!isConfigured || studentsWithoutDvaCount === 0 ? 'done' : 'notrun')
  const s4: StepStatus = 'notrun'

  const p2 = total > 0 ? dvaCount / total : (isConfigured ? 1 : 0)
  const p3 = running && job && job.total > 0 ? job.processed / job.total : justFinished ? 1 : 0

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Give every student an account to pay into
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          A virtual account per student is what makes a payment reconcile itself. Provisioning runs in the
          background and survives you leaving the page.
        </p>
      </div>

      <div style={{ marginTop: 8 }}>
        {/* 01 — Provider connected */}
        <LedgerStep
          n="01"
          title="Provider connected"
          status={s1}
          statusLabel={s1 === 'done' ? 'DONE' : 'NOT CONNECTED'}
          desc={
            isConfigured
              ? `${providerLabel} · credentials configured.`
              : 'Connect a payment provider in School settings, Payments before accounts can be created.'
          }
          progress={1}
          showBar={isConfigured}
        />

        {/* 02 — Accounts provisioned */}
        <LedgerStep
          n="02"
          title="Accounts provisioned"
          status={s2}
          statusLabel={
            !isConfigured ? 'NOT RUN'
            : studentsWithoutDvaCount > 0 ? `${studentsWithoutDvaCount} MISSING`
            : 'DONE'
          }
          desc={
            !isConfigured
              ? 'Runs once a provider is connected.'
              : studentsWithoutDvaCount > 0
                ? `${dvaCount} ${dvaCount === 1 ? 'account' : 'accounts'} created. ${studentsWithoutDvaCount} active ${studentsWithoutDvaCount === 1 ? 'student has' : 'students have'} nowhere to pay.`
                : `${dvaCount} ${dvaCount === 1 ? 'account' : 'accounts'} created. Every active student can be paid into.`
          }
          progress={p2}
          showBar={isConfigured}
        />

        {/* 03 — Provision the rest */}
        <LedgerStep
          n="03"
          title="Provision the rest"
          status={s3}
          statusLabel={running ? 'RUNNING' : (!isConfigured || studentsWithoutDvaCount === 0) ? 'DONE' : 'READY'}
          desc={
            running
              ? (job ? `Creating accounts — ${job.processed} of ${job.total}.` : 'Working...')
              : studentsWithoutDvaCount > 0 && isConfigured
                ? `Creates ${studentsWithoutDvaCount} ${studentsWithoutDvaCount === 1 ? 'account' : 'accounts'}. You can leave this page; the progress strip follows you.`
                : justFinished
                  ? `${createdCount} ${createdCount === 1 ? 'account' : 'accounts'} created.`
                  : 'Every active student already has an account. Nothing to provision.'
          }
          progress={p3}
          showBar={running || justFinished}
        >
          {isConfigured && studentsWithoutDvaCount > 0 && !running && (
            <div>
              {error && (
                <div className="mb-4 p-3 text-sm text-[var(--color-signal-text)]" style={{ background: 'var(--color-signal-100)', borderLeft: '3px solid var(--color-signal)' }}>
                  {error}
                </div>
              )}
              <button onClick={handleProvision} disabled={starting} className="m-btn m-btn-primary">
                {starting ? 'Starting...' : `Create ${studentsWithoutDvaCount} ${studentsWithoutDvaCount === 1 ? 'account' : 'accounts'}`}
              </button>
            </div>
          )}

          {running && (
            <div>
              {job && (
                <p className="text-sm font-semibold text-[var(--color-ink)] m-num" style={{ margin: 0 }}>
                  {job.processed} of {job.total} · {job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0}%
                </p>
              )}
              <p className="text-xs text-[var(--color-neutral-700)]" style={{ marginTop: 4, maxWidth: '74ch' }}>
                This runs in the background — you can leave this page and we will keep going.
              </p>
              {job && (
                <button
                  onClick={() => cancelJob(job.jobId)}
                  disabled={!!job.cancelling}
                  className="mt-3 text-xs font-semibold text-[var(--color-signal-text)] hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {job.cancelling ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
            </div>
          )}
        </LedgerStep>

        {/* 04 — Tell the parents (presentational; no bulk send-account-details action exists yet) */}
        <LedgerStep
          n="04"
          title="Tell the parents"
          status={s4}
          statusLabel="AFTER STEP 3"
          desc="Each new account number reaches parents on the next invoice or reminder that goes out, which always carries the account and bank."
          progress={0}
          showBar={false}
        />
      </div>
    </div>
  )
}
