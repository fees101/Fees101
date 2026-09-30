'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { parseAndValidateCSV, startCsvImportJob } from '@/app/(app)/students/import/actions'
import { startBulkDVAJob } from '@/app/(app)/students/[id]/actions'
import { useActiveJobs, useTrackedJob, useOnJobOpenRequested, type TrackedJob } from '@/lib/jobs/ActiveJobsProvider'
import { LedgerStep, type StepStatus } from './LedgerStep'

interface ParsedRow {
  rowNumber: number
  firstName: string
  lastName: string
  admissionNumber: string
  className: string
  admissionDate: string
  parentName: string
  parentPhone: string
  parentEmail: string
  secondaryParentName: string
  secondaryParentPhone: string
  secondaryParentEmail: string
  notes: string
  errors: string[]
  classId?: string
}

type Step = 'upload' | 'review' | 'importing' | 'success'

export default function CSVImportFlow() {
  const router = useRouter()
  const { trackJob, findRunningJob, cancelJob } = useActiveJobs()
  const existingImportJob = findRunningJob(j => j.jobType === 'csv_import')
  const existingDvaJob = findRunningJob(j => j.jobType === 'bulk_dva')
  // Reopen straight to the progress view if either phase is already running
  // (e.g. the user navigated away with "Run in background" and came back) —
  // otherwise the review step would resurface and look re-submittable.
  const [step, setStep] = useState<Step>(existingImportJob || existingDvaJob ? 'importing' : 'upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [summary, setSummary] = useState({ total: 0, valid: 0, invalid: 0 })
  // File name + column-recognition counts drive the "File read" and "Columns"
  // step lines. Set on a successful parse, cleared on start-over.
  const [fileName, setFileName] = useState<string | null>(null)
  const [colMeta, setColMeta] = useState<{ columns: number; recognised: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number, failed: number, breakdown: Record<string, number>, accountsCreated: number, dvaCancelled?: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [jobId, setJobId] = useState<string | null>(existingImportJob?.jobId ?? null)
  const job = useTrackedJob(jobId)
  const [dvaJobId, setDvaJobId] = useState<string | null>(existingDvaJob?.jobId ?? null)
  const dvaJob = useTrackedJob(dvaJobId)
  // Clicking the chip while already on this page doesn't navigate anywhere,
  // so force the progress view open explicitly rather than relying on a
  // remount.
  useOnJobOpenRequested(existingImportJob?.jobId, () => setStep('importing'))
  useOnJobOpenRequested(existingDvaJob?.jobId, () => setStep('importing'))
  const validRowsRef = useRef<ParsedRow[]>([])

  // Phase 1 (student import) and phase 2 (account provisioning) both run as
  // background_jobs rows via trackJob, so both keep advancing and completing
  // regardless of whether this component is still mounted.

  // Phase 1's progress comes from the csv_import job; once it completes,
  // phase 2's progress comes from the bulk_dva job (started in its
  // completion callback below).
  const displayProgress = job && job.status === 'running'
    ? { label: 'Importing students', done: job.processed, total: job.total }
    : dvaJob && dvaJob.status === 'running'
      ? { label: 'Creating payment accounts', done: dvaJob.processed, total: dvaJob.total }
      : null

  // Whichever phase is currently running is the one Cancel should target —
  // both are real background_jobs rows, so the same cancelJob works for
  // either.
  const activeJob = job?.status === 'running' ? job : dvaJob?.status === 'running' ? dvaJob : null

  async function handleFile(file: File) {
    setError(null)
    setLoading(true)

    if (!file.name.endsWith('.csv')) {
      setError('Please upload a CSV file')
      setLoading(false)
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB')
      setLoading(false)
      return
    }

    try {
      const text = await file.text()
      const result = await parseAndValidateCSV(text)

      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }

      if (!result.rows || result.rows.length === 0) {
        setError('No data rows found in the file')
        setLoading(false)
        return
      }

      setRows(result.rows)
      setSummary(result.summary!)
      setFileName(file.name)
      setColMeta({ columns: result.columns ?? 0, recognised: result.recognisedColumns ?? 0 })
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    } finally {
      setLoading(false)
    }
  }

  async function finalizeAfterImport(finishedJob: TrackedJob) {
    if (finishedJob.status === 'failed') {
      setError(finishedJob.error || 'Import failed')
      setStep('review')
      return
    }
    if (finishedJob.status === 'cancelled') {
      setError(`Cancelled — ${finishedJob.processed} student${finishedJob.processed === 1 ? '' : 's'} imported before stopping.`)
      setStep('review')
      router.refresh()
      return
    }

    const failedRowNumbers = new Set(
      (finishedJob.failures || [])
        .map(f => parseInt(f.label.replace('Row ', ''), 10))
        .filter(n => !isNaN(n))
    )
    const breakdown: Record<string, number> = {}
    for (const row of validRowsRef.current) {
      if (!failedRowNumbers.has(row.rowNumber)) {
        breakdown[row.className] = (breakdown[row.className] || 0) + 1
      }
    }

    const finish = (accountsCreated: number) => {
      setImportResult({ imported: finishedJob.processed, failed: finishedJob.failed ?? 0, breakdown, accountsCreated })
      setStep('success')
      router.refresh()
    }

    // Phase 2 — automatically provision payment accounts for the students who
    // now need one (the just-imported ones, plus any earlier stragglers). If
    // payments aren't configured, startBulkDVAJob returns an error and we
    // simply skip this phase.
    const dvaStart = await startBulkDVAJob()
    if ('error' in dvaStart || !dvaStart.jobId) {
      finish(0)
      return
    }

    setDvaJobId(dvaStart.jobId)
    trackJob(dvaStart.jobId, 'bulk_dva', 'Creating payment accounts', {
      processed: dvaStart.processed,
      total: dvaStart.total,
    }, (dvaJobFinished) => finalizeAfterDva(dvaJobFinished), { href: '/students/import' })
  }

  function finalizeAfterDva(dvaJobFinished: TrackedJob) {
    setImportResult(prev => ({
      imported: prev?.imported ?? 0,
      failed: prev?.failed ?? 0,
      breakdown: prev?.breakdown ?? {},
      accountsCreated: dvaJobFinished.status === 'failed' ? 0 : dvaJobFinished.processed,
      dvaCancelled: dvaJobFinished.status === 'cancelled',
    }))
    setStep('success')
    router.refresh()
  }

  // If this instance resumed an already-running job (rather than starting
  // one itself), the trackJob onComplete callbacks below were registered by
  // a previous, now-unmounted instance of this component and won't fire
  // here — without this, a resumed page would sit on the progress spinner
  // forever once the job finishes, needing a manual refresh to notice.
  const resumedImportRef = useRef(!!existingImportJob)
  const resumedDvaRef = useRef(!!existingDvaJob)

  useEffect(() => {
    if (!resumedImportRef.current || !job || job.status === 'running') return
    resumedImportRef.current = false
    finalizeAfterImport(job)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job])

  useEffect(() => {
    if (!resumedDvaRef.current || !dvaJob || dvaJob.status === 'running') return
    resumedDvaRef.current = false
    finalizeAfterDva(dvaJob)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dvaJob])

  async function handleConfirmImport() {
    setError(null)
    setStep('importing')

    const validRows = rows.filter(r => r.errors.length === 0)
    validRowsRef.current = validRows

    const start = await startCsvImportJob(validRows)
    if ('error' in start) {
      setError(start.error ?? 'Something went wrong')
      setStep('review')
      return
    }

    setJobId(start.jobId)
    trackJob(start.jobId, 'csv_import', 'Importing students', {
      processed: start.processed ?? 0,
      total: start.total ?? validRows.length,
    }, (finishedJob) => finalizeAfterImport(finishedJob), { href: '/students/import' })
  }

  function handleStartOver() {
    setStep('upload')
    setRows([])
    setSummary({ total: 0, valid: 0, invalid: 0 })
    setFileName(null)
    setColMeta(null)
    setError(null)
    setImportResult(null)
  }

  // ── Step state derivation ─────────────────────────────────────────────────
  // The surface shows all four steps at once, each carrying its own status word
  // and a progress rule, so a bursar always sees how far the run got and what
  // it will write. States map onto the real flow: a file parses (steps 1-3
  // resolve together, since columns match the template exactly and rows are
  // validated in the same pass), then the final step writes on confirm.
  const hasParse = rows.length > 0
  const importing = step === 'importing'
  const done = step === 'success'
  const reached = hasParse || importing || done

  const problemRows = rows.filter(r => r.errors.length > 0)
  const dupCount = rows.filter(r => r.errors.some(e => e.includes('Duplicate admission number') || e.includes('already exists'))).length
  const classCount = rows.filter(r => r.errors.some(e => e.includes("doesn't exist at this school"))).length
  const missingCount = rows.filter(r => r.errors.some(e => e.includes('is required'))).length
  const contactCount = rows.filter(r => r.errors.some(e => e.includes('not a valid') || e.includes('is not valid') || e.includes('YYYY-MM-DD'))).length

  const s1: StepStatus = reached ? 'done' : loading ? 'running' : 'notrun'
  const s2: StepStatus = reached ? 'done' : 'notrun'
  const s3: StepStatus = importing || done ? 'done' : hasParse ? (summary.invalid > 0 ? 'attention' : 'done') : 'notrun'
  const s4: StepStatus = done ? 'done' : importing ? 'running' : 'notrun'

  const problemBits: string[] = []
  if (dupCount) problemBits.push(`${dupCount} duplicate admission ${dupCount === 1 ? 'number' : 'numbers'}`)
  if (classCount) problemBits.push(`${classCount} ${classCount === 1 ? 'row with an unknown class' : 'rows with an unknown class'}`)
  if (missingCount) problemBits.push(`${missingCount} missing a required field`)
  if (contactCount) problemBits.push(`${contactCount} invalid contact ${contactCount === 1 ? 'detail' : 'details'}`)

  const p1 = s1 === 'done' ? 1 : 0
  const p2 = s2 === 'done' ? 1 : 0
  const p3 = hasParse ? (summary.total > 0 ? summary.valid / summary.total : 1) : (importing || done ? 1 : 0)
  const p4 = done ? 1 : importing && displayProgress && displayProgress.total > 0 ? displayProgress.done / displayProgress.total : 0

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Import students from a spreadsheet
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          Four steps, all visible at once, so you always know how far the import got and what it will create.
          Nothing is written until the last step.
        </p>
      </div>

      <div style={{ marginTop: 8 }}>
        {/* 01 — File read */}
        <LedgerStep
          n="01"
          title="File read"
          status={s1}
          statusLabel={s1 === 'done' ? 'DONE' : s1 === 'running' ? 'READING' : 'NOT RUN'}
          desc={
            reached
              ? (fileName && colMeta
                  ? `${fileName} · ${summary.total} ${summary.total === 1 ? 'row' : 'rows'}, ${colMeta.columns} columns detected.`
                  : 'File read and validated.')
              : 'Choose a CSV file to begin. It is read in your browser and checked before anything is saved.'
          }
          progress={p1}
          showBar={s1 !== 'notrun'}
        >
          {step === 'upload' && (
            <UploadArea
              onFileSelect={handleFile}
              dragging={dragging}
              setDragging={setDragging}
              error={error}
              loading={loading}
            />
          )}
        </LedgerStep>

        {/* 02 — Columns mapped */}
        <LedgerStep
          n="02"
          title="Columns mapped"
          status={s2}
          statusLabel={s2 === 'done' ? 'DONE' : 'NOT RUN'}
          desc={
            reached
              ? (colMeta
                  ? (colMeta.recognised >= colMeta.columns
                      ? `All ${colMeta.columns} columns recognised from the template.`
                      : `${colMeta.recognised} of ${colMeta.columns} columns recognised; the rest are ignored.`)
                  : 'Columns matched to the template.')
              : 'Columns are matched to the template automatically once a file is read.'
          }
          progress={p2}
          showBar={s2 !== 'notrun'}
        />

        {/* 03 — Rows checked */}
        <LedgerStep
          n="03"
          title="Rows checked"
          status={s3}
          statusLabel={
            s3 === 'attention'
              ? `${summary.invalid} ${summary.invalid === 1 ? 'PROBLEM' : 'PROBLEMS'}`
              : s3 === 'done' ? 'DONE' : 'NOT RUN'
          }
          desc={
            hasParse
              ? `${summary.valid} ready.${problemBits.length ? ` ${problemBits.join(', ')} — each listed with the row number so you can fix the file.` : ''}`
              : (importing || done
                  ? 'Rows validated before import.'
                  : 'Ready and problem rows are counted once a file is read.')
          }
          progress={p3}
          showBar={hasParse || importing || done}
        >
          {hasParse && problemRows.length > 0 && (
            <div className="overflow-x-auto" style={{ marginTop: 4, maxHeight: 360, overflowY: 'auto', border: '1px solid var(--color-neutral-300)' }}>
              <table className="m-table">
                <thead className="sticky top-0" style={{ background: 'var(--color-paper)' }}>
                  <tr>
                    <th style={{ width: 56 }}>Row</th>
                    <th>Student</th>
                    <th>What to fix</th>
                  </tr>
                </thead>
                <tbody>
                  {problemRows.map(row => (
                    <tr key={row.rowNumber}>
                      <td className="m-num text-[var(--color-neutral-700)]">{row.rowNumber}</td>
                      <td className="text-[var(--color-ink)]">{[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}</td>
                      <td>
                        {row.errors.map((err, i) => (
                          <p key={i} className="text-xs text-[var(--color-ochre-text)]" style={{ margin: 0 }}>{err}</p>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LedgerStep>

        {/* 04 — Create students */}
        <LedgerStep
          n="04"
          title="Create students"
          status={s4}
          statusLabel={s4 === 'done' ? 'DONE' : s4 === 'running' ? 'RUNNING' : 'NOT RUN'}
          desc={
            done
              ? undefined
              : importing
                ? (displayProgress ? `${displayProgress.label} — ${displayProgress.done} of ${displayProgress.total}.` : 'Working...')
                : (hasParse
                    ? `Writes ${summary.valid} ${summary.valid === 1 ? 'student' : 'students'}. No invoices are generated — that stays a separate, deliberate step.`
                    : 'The final step writes the students. No invoices are generated — that stays a separate, deliberate step.')
          }
          progress={p4}
          showBar={importing || done}
        >
          {step === 'review' && (
            <div style={{ marginTop: 4 }}>
              {error && (
                <div className="mb-4 p-3 text-sm text-[var(--color-signal-text)]" style={{ background: 'var(--color-signal-100)', borderLeft: '3px solid var(--color-signal)' }}>
                  {error}
                </div>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={handleConfirmImport} disabled={loading || summary.valid === 0} className="m-btn m-btn-primary">
                  {summary.invalid > 0 ? `Skip flagged rows and create ${summary.valid}` : `Create ${summary.valid} ${summary.valid === 1 ? 'student' : 'students'}`}
                </button>
                <button onClick={handleStartOver} disabled={loading} className="m-btn m-btn-outline">
                  Start over
                </button>
              </div>
            </div>
          )}

          {importing && displayProgress && (
            <div style={{ marginTop: 4 }}>
              <p className="text-sm font-semibold text-[var(--color-ink)] m-num" style={{ margin: 0 }}>
                {displayProgress.done} of {displayProgress.total} · {displayProgress.total > 0 ? Math.round((displayProgress.done / displayProgress.total) * 100) : 0}%
              </p>
              <p className="text-xs text-[var(--color-neutral-700)]" style={{ marginTop: 4, maxWidth: '74ch' }}>
                This runs in the background — you can leave this page and we will keep going.
              </p>
              {activeJob && (
                <button
                  onClick={() => cancelJob(activeJob.jobId)}
                  disabled={!!activeJob.cancelling}
                  className="mt-3 text-xs font-semibold text-[var(--color-signal-text)] hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {activeJob.cancelling ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
            </div>
          )}

          {done && importResult && (
            <SuccessBody
              imported={importResult.imported}
              failed={importResult.failed}
              breakdown={importResult.breakdown}
              accountsCreated={importResult.accountsCreated}
              dvaCancelled={importResult.dvaCancelled}
              onViewStudents={() => router.push('/students')}
              onImportMore={handleStartOver}
            />
          )}
        </LedgerStep>
      </div>
    </div>
  )
}

// The step-1 body when no file has been read yet: a drop zone, a template
// download, and the column requirements — flush on paper, no cards.
function UploadArea({ onFileSelect, dragging, setDragging, error, loading }: {
  onFileSelect: (file: File) => void
  dragging: boolean
  setDragging: (b: boolean) => void
  error: string | null
  loading: boolean
}) {
  return (
    <div>
      <div
        className="text-center"
        style={{
          padding: 40,
          border: `2px dashed ${dragging ? 'var(--color-ink)' : 'var(--color-neutral-400)'}`,
          background: dragging ? 'var(--color-surface)' : 'transparent',
          transition: 'border-color var(--dur-tick) var(--ease-out), background var(--dur-tick) var(--ease-out)',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFileSelect(f) }}
      >
        <p className="text-base font-semibold text-[var(--color-ink)]" style={{ margin: 0 }}>Drop your CSV file here</p>
        <p className="text-sm text-[var(--color-neutral-700)]" style={{ margin: '2px 0 0' }}>or choose it from your computer. Accepts .csv up to 5MB.</p>
        <label className="m-btn m-btn-primary inline-flex cursor-pointer" style={{ marginTop: 16 }}>
          {loading ? 'Reading file...' : 'Choose file'}
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(f) }}
            disabled={loading}
          />
        </label>
        {error && (
          <p className="mt-4 text-sm text-[var(--color-signal-text)] inline-block" style={{ background: 'var(--color-signal-100)', padding: '8px 16px' }}>{error}</p>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2" style={{ marginTop: 16 }}>
        <a href="/students-template.csv" download className="text-[13px] font-semibold text-[var(--color-ink)] underline underline-offset-4 decoration-[var(--color-neutral-400)] hover:decoration-[var(--color-ink)]">
          Download the CSV template
        </a>
        <span className="text-[13px] text-[var(--color-neutral-700)]">
          Required: first &amp; last name, admission number, class, parent name, parent phone. Optional: parent email, admission date, second parent, notes.
        </span>
      </div>
    </div>
  )
}

// The step-4 body once the run has finished: totals, the per-class breakdown,
// and where to go next.
function SuccessBody({ imported, failed, breakdown, accountsCreated, dvaCancelled, onViewStudents, onImportMore }: {
  imported: number
  failed: number
  breakdown: Record<string, number>
  accountsCreated: number
  dvaCancelled?: boolean
  onViewStudents: () => void
  onImportMore: () => void
}) {
  const sortedClasses = Object.entries(breakdown).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })

  return (
    <div>
      <p className="text-[13px] text-[var(--color-ink)]" style={{ margin: 0 }}>
        <span style={{ color: 'var(--color-ink)', fontWeight: 700 }}>{imported} {imported === 1 ? 'student' : 'students'} added</span>
        {failed > 0 && `, ${failed} ${failed === 1 ? 'row' : 'rows'} failed`}
        {accountsCreated > 0 && ` · ${accountsCreated} payment ${accountsCreated === 1 ? 'account' : 'accounts'} created`}.
      </p>

      {sortedClasses.length > 0 && (
        <div style={{ marginTop: 12, maxWidth: 460, border: '1px solid var(--color-neutral-300)', maxHeight: 320, overflowY: 'auto' }}>
          {sortedClasses.map(([className, count], i) => (
            <div key={className} className="flex items-center justify-between" style={{ padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--color-neutral-300)' }}>
              <span className="text-sm text-[var(--color-ink)]">{className}</span>
              <span className="text-sm text-[var(--color-neutral-700)] m-num">{count} {count === 1 ? 'student' : 'students'}</span>
            </div>
          ))}
        </div>
      )}

      {dvaCancelled && (
        <p className="text-[13px] text-[var(--color-ochre-text)]" style={{ marginTop: 12, maxWidth: '74ch' }}>
          Payment account creation was cancelled — {accountsCreated} account{accountsCreated === 1 ? '' : 's'} created before stopping. You can create the rest from Students or School settings, Payments.
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 16 }}>
        <button onClick={onViewStudents} className="m-btn m-btn-primary">View all students</button>
        <button onClick={onImportMore} className="m-btn m-btn-outline">Import more</button>
      </div>
    </div>
  )
}
