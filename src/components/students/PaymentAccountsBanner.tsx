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
      <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12a2 2 0 00-3.48 0l-7.07 12a2 2 0 001.74 3z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {studentsWithoutDvaCount} active {studentsWithoutDvaCount === 1 ? 'student doesn’t' : 'students don’t'} have a payment account yet
            </p>
            <p className="text-sm text-amber-700 mt-0.5">Parents can only pay by transfer once each student has a virtual account.</p>
          </div>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          disabled={panelOpen && running}
          title={running && !panelOpen ? 'Account creation is already running — click to view progress' : undefined}
          className="flex-shrink-0 px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 disabled:opacity-50 text-center"
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
