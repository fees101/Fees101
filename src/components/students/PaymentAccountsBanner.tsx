'use client'

import { useState } from 'react'
import { useActiveJobs, useOnJobOpenRequested } from '@/lib/jobs/ActiveJobsProvider'
import BulkDVAPanel from './BulkDVAPanel'

interface Props {
  studentsWithoutDvaCount: number
}

export default function PaymentAccountsBanner({ studentsWithoutDvaCount }: Props) {
  const { findRunningJob } = useActiveJobs()
  // Re-derived every render (not frozen in useState) so the button stays
  // disabled with a live "Creating..." label for as long as the job is
  // running, including after the panel below has been closed via "Run in
  // background" — see the same fix applied to InvoicesListLayout.
  const existingJob = findRunningJob(j => j.jobType === 'bulk_dva')
  const running = !!existingJob
  const [panelOpen, setPanelOpen] = useState(running)
  // Clicking the chip while already on this page doesn't navigate anywhere,
  // so force the panel open explicitly rather than relying on a remount.
  useOnJobOpenRequested(existingJob?.jobId, () => setPanelOpen(true))

  // A job started here keeps running (and the chip keeps showing) even once
  // studentsWithoutDvaCount drops to 0 after a refresh, so don't let that
  // hide the banner while there's still something to see or cancel.
  if (studentsWithoutDvaCount === 0 && !running) return null

  return (
    <>
      <div className="mb-6 pl-3 border-l-2 border-[var(--color-ink)] flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="py-0.5">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {studentsWithoutDvaCount} active {studentsWithoutDvaCount === 1 ? 'student doesn’t' : 'students don’t'} have a payment account yet
          </p>
          <p className="text-sm text-[var(--color-neutral-700)] mt-0.5">Parents can only pay by transfer once each student has a virtual account.</p>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          disabled={panelOpen && running}
          title={running && !panelOpen ? 'Account creation is already running — click to view progress' : undefined}
          className="m-btn m-btn-primary flex-shrink-0 disabled:opacity-50"
        >
          {running ? `Creating… (${existingJob.processed} done)` : 'Create accounts'}
        </button>
      </div>

      {panelOpen && (
        <BulkDVAPanel count={studentsWithoutDvaCount} href="/students" onClose={() => setPanelOpen(false)} />
      )}
    </>
  )
}
