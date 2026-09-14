'use client'

// Keeps a background_jobs job's poll loop alive at the (app) layout level
// instead of inside whichever modal/panel started it, so navigating to a
// different page (Students, Settings, etc.) — which unmounts that panel —
// doesn't stop the job from advancing, and firing a toast when it completes
// works no matter which page the user is on when that happens.
//
// A full page reload (not just client-side navigation) does remount this
// provider, which would otherwise lose track of an in-flight job — so the
// jobId/type/label triple is mirrored to localStorage and replayed on mount.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { pollJob } from './pollJob'

export type TrackedJobType = 'invoice_generation' | 'invoice_regeneration' | 'csv_import' | 'bulk_dva' | 'bulk_send'

export interface TrackedJob {
  jobId: string
  jobType: TrackedJobType
  label: string
  processed: number
  total: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  failed?: number
  failures?: { label: string; error: string }[]
  error?: string
  // Arbitrary caller-supplied context (e.g. { cycleId, href }) — lets a page
  // find "is one of my jobs already running" and a global indicator know
  // where "view" should navigate to.
  meta?: Record<string, string>
  // Set optimistically the moment Cancel is clicked, before the server has
  // actually flipped status away from 'running' — cancellation only takes
  // effect between chunks, so there's a real (if usually short) gap.
  cancelling?: boolean
}

interface PersistedJob {
  jobId: string
  jobType: TrackedJobType
  label: string
  meta?: Record<string, string>
}

type CompletionListener = (job: TrackedJob) => void

interface ActiveJobsValue {
  jobs: Record<string, TrackedJob>
  trackJob: (
    jobId: string,
    jobType: TrackedJobType,
    label: string,
    initial?: { processed?: number; total?: number },
    onComplete?: CompletionListener,
    meta?: Record<string, string>
  ) => void
  dismissJob: (jobId: string) => void
  // Find an already-tracked, still-running job matching a predicate — used by
  // a page to notice "this cycle already has a generation job going" without
  // re-clicking the button that started it.
  findRunningJob: (predicate: (job: TrackedJob) => boolean) => TrackedJob | undefined
  // Ask the server to stop a running job. Best-effort and not immediate — see
  // TrackedJob.cancelling — the existing poll loop picks up the real
  // 'cancelled' status once the server applies it.
  cancelJob: (jobId: string) => void
  // Set by the floating chip's click handler. Navigating to a different page
  // (meta.href) already reopens that page's panel via its own
  // findRunningJob-seeded initial state — but clicking a chip while already
  // on the page that owns the job is not a navigation at all, so nothing
  // would otherwise happen. Owning components call useOnJobOpenRequested to
  // notice this and force their panel open explicitly.
  openRequest: { jobId: string; nonce: number } | null
  requestOpenJob: (jobId: string) => void
}

const ActiveJobsContext = createContext<ActiveJobsValue | null>(null)

const STORAGE_KEY = 'fees101_active_jobs'

function readPersisted(): PersistedJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writePersisted(list: PersistedJob[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // best-effort — losing this only means a hard reload won't auto-resume
  }
}

interface ToastEntry {
  id: string
  message: string
  ok: boolean
}

export function ActiveJobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, TrackedJob>>({})
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  // Chips the user has hidden from the floating widget — the job underneath
  // keeps running/polling either way. This is deliberately separate from
  // cancelJob: hiding is "get this out of my way", cancel is "stop the job",
  // and conflating them (the old single "x") made hiding a job look like it
  // silently failed.
  const [hiddenChipIds, setHiddenChipIds] = useState<Set<string>>(new Set())
  const [openRequest, setOpenRequest] = useState<{ jobId: string; nonce: number } | null>(null)
  const openNonce = useRef(0)
  const polling = useRef<Set<string>>(new Set())
  // Per-job "notify me when this finishes" callback, invoked from the poll
  // promise's own resolution rather than a component effect watching state —
  // works whether or not the caller is still mounted when it fires, and
  // avoids a state-in-effect anti-pattern for what's really an external
  // event (see GenerateInvoicesPanel/CycleDetailLayout for callers).
  const completionListeners = useRef<Map<string, CompletionListener>>(new Map())

  const removeFromPersisted = useCallback((jobId: string) => {
    writePersisted(readPersisted().filter(j => j.jobId !== jobId))
  }, [])

  const drive = useCallback((jobId: string, jobType: TrackedJobType, label: string, meta?: Record<string, string>) => {
    if (polling.current.has(jobId)) return
    polling.current.add(jobId)

    pollJob(jobId, (s) => {
      setJobs(prev => ({
        ...prev,
        [jobId]: {
          jobId, jobType, label, processed: s.processed, total: s.total, status: 'running',
          meta: meta ?? prev[jobId]?.meta,
          cancelling: prev[jobId]?.cancelling,
        },
      }))
    })
      .then((final) => {
        polling.current.delete(jobId)
        removeFromPersisted(jobId)
        const finalJob: TrackedJob = {
          jobId,
          jobType,
          label,
          processed: final.processed,
          total: final.total,
          status: final.status as TrackedJob['status'],
          failed: final.failed,
          failures: final.failures,
          error: final.error,
          meta,
        }
        setJobs(prev => ({ ...prev, [jobId]: finalJob }))

        if (final.status === 'completed') {
          const failedNote = final.failed ? `, ${final.failed} failed` : ''
          setToasts(t => [
            ...t,
            { id: jobId, ok: true, message: `${label} complete — ${final.processed}${final.total ? `/${final.total}` : ''}${failedNote}` },
          ])
        } else if (final.status === 'failed') {
          setToasts(t => [...t, { id: jobId, ok: false, message: `${label} failed — ${final.error || 'something went wrong'}` }])
        } else if (final.status === 'cancelled') {
          setToasts(t => [...t, { id: jobId, ok: false, message: `${label} cancelled — ${final.processed}${final.total ? `/${final.total}` : ''} done` }])
        }

        const listener = completionListeners.current.get(jobId)
        completionListeners.current.delete(jobId)
        listener?.(finalJob)
      })
      .catch(() => {
        polling.current.delete(jobId)
      })
  }, [removeFromPersisted])

  const trackJob = useCallback((
    jobId: string,
    jobType: TrackedJobType,
    label: string,
    initial?: { processed?: number; total?: number },
    onComplete?: CompletionListener,
    meta?: Record<string, string>
  ) => {
    setJobs(prev => ({
      ...prev,
      [jobId]: prev[jobId] || {
        jobId, jobType, label,
        processed: initial?.processed ?? 0,
        total: initial?.total ?? 0,
        status: 'running',
        meta,
      },
    }))
    const persisted = readPersisted()
    if (!persisted.some(j => j.jobId === jobId)) {
      writePersisted([...persisted, { jobId, jobType, label, meta }])
    }
    if (onComplete) completionListeners.current.set(jobId, onComplete)
    drive(jobId, jobType, label, meta)
  }, [drive])

  const dismissJob = useCallback((jobId: string) => {
    setJobs(prev => {
      const next = { ...prev }
      delete next[jobId]
      return next
    })
  }, [])

  const findRunningJob = useCallback((predicate: (job: TrackedJob) => boolean) => {
    return Object.values(jobs).find(j => j.status === 'running' && predicate(j))
  }, [jobs])

  const cancelJob = useCallback((jobId: string) => {
    setJobs(prev => (prev[jobId] ? { ...prev, [jobId]: { ...prev[jobId], cancelling: true } } : prev))
    fetch('/api/jobs/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(() => {
      // best-effort — the poll loop already running for this job will still
      // pick up 'cancelled' once the server applies it, even if this
      // particular request failed to round-trip
    })
  }, [])

  // Resume any job still marked running from before a hard reload. SPA
  // navigation between pages never unmounts this provider (mounted once in
  // the (app) layout), so this effect only ever fires on real (re)mounts.
  useEffect(() => {
    for (const j of readPersisted()) drive(j.jobId, j.jobType, j.label, j.meta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const hideChip = useCallback((jobId: string) => {
    setHiddenChipIds(prev => new Set(prev).add(jobId))
  }, [])

  const requestOpenJob = useCallback((jobId: string) => {
    openNonce.current += 1
    setOpenRequest({ jobId, nonce: openNonce.current })
  }, [])

  const runningJobs = Object.values(jobs).filter(j => j.status === 'running' && !hiddenChipIds.has(j.jobId))
  const hiddenRunningJobs = Object.values(jobs).filter(j => j.status === 'running' && hiddenChipIds.has(j.jobId))

  const restoreHiddenChips = useCallback(() => {
    setHiddenChipIds(new Set())
  }, [])

  // Memoized so a page that only reads trackJob/dismissJob/findRunningJob
  // (not jobs itself) doesn't re-render on every ~1.5s poll tick — jobs still
  // changes reference each tick, so this doesn't help while a job the current
  // page cares about is running, but it stops the churn from bleeding into
  // every other mounted page in the app for jobs they don't track.
  const value = useMemo(
    () => ({ jobs, trackJob, dismissJob, findRunningJob, cancelJob, openRequest, requestOpenJob }),
    [jobs, trackJob, dismissJob, findRunningJob, cancelJob, openRequest, requestOpenJob]
  )

  return (
    <ActiveJobsContext.Provider value={value}>
      {children}
      <div className="fixed bottom-6 right-6 z-[110] flex flex-col-reverse gap-3 items-end pointer-events-none max-w-[calc(100vw-3rem)]">
        {hiddenRunningJobs.length > 0 && (
          <button
            onClick={restoreHiddenChips}
            className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full shadow-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <div className="w-2.5 h-2.5 border-2 border-mint border-t-transparent rounded-full animate-spin flex-shrink-0" />
            {hiddenRunningJobs.length} hidden job{hiddenRunningJobs.length === 1 ? '' : 's'} running — Show
          </button>
        )}
        {runningJobs.map(j => {
          const pct = j.total > 0 ? Math.min(100, Math.round((j.processed / j.total) * 100)) : 0
          const inner = (
            <>
              <div className="w-4 h-4 border-2 border-mint border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-navy truncate">
                  {j.cancelling ? 'Cancelling...' : `${j.label}... ${j.processed}/${j.total || '?'}`}
                </p>
                <div className="w-40 h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-mint transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
              {/* Hides the chip only — the job keeps running/polling in the
                  background. Cancelling the actual job only happens from
                  inside that job's own modal/panel, where it's an explicit,
                  labelled action rather than a small corner "x" someone
                  could mistake for "close this popup". */}
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); hideChip(j.jobId) }}
                aria-label="Hide"
                title="Hide (keeps running in the background)"
                className="p-1 -m-1 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )
          const cls = 'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border border-gray-200 bg-white max-w-sm'
          // Clicking the chip itself (not the hide "x") takes you back to the
          // page that owns this job, so you can see full progress, failures
          // so far, and the real Cancel button inside its modal/panel.
          // requestOpenJob also fires so a page that's already mounted (no
          // navigation happens, or the owning panel was closed) forces its
          // panel open in response, instead of the click doing nothing.
          return j.meta?.href ? (
            <Link
              key={j.jobId}
              href={j.meta.href}
              onClick={() => requestOpenJob(j.jobId)}
              className={`${cls} hover:bg-gray-50 cursor-pointer`}
              title="View progress"
            >
              {inner}
            </Link>
          ) : (
            <div key={j.jobId} className={cls}>{inner}</div>
          )
        })}
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto max-w-sm">
            <div className={`flex items-start gap-3 p-4 rounded-xl shadow-lg border bg-white ${t.ok ? 'border-mint/30' : 'border-red-200'}`}>
              {t.ok ? (
                <svg className="w-5 h-5 text-mint flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              <p className="text-sm text-navy flex-1">{t.message}</p>
              <button
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss"
                className="p-1.5 -m-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </ActiveJobsContext.Provider>
  )
}

export function useActiveJobs() {
  const ctx = useContext(ActiveJobsContext)
  if (!ctx) throw new Error('useActiveJobs must be used within ActiveJobsProvider')
  return ctx
}

export function useTrackedJob(jobId: string | null | undefined): TrackedJob | undefined {
  const { jobs } = useActiveJobs()
  return jobId ? jobs[jobId] : undefined
}

// Lets a job's owning panel/modal force itself open when the floating chip
// for that exact job is clicked. Navigating to a different page is already
// handled by that page seeding its initial open-state from findRunningJob —
// this hook only needs to fire for the case that isn't a navigation at all:
// the chip's owning page is already mounted, so clicking it wouldn't
// otherwise do anything.
export function useOnJobOpenRequested(jobId: string | null | undefined, onOpen: () => void) {
  const { openRequest } = useActiveJobs()
  const handledNonce = useRef(0)
  const onOpenRef = useRef(onOpen)
  useEffect(() => {
    onOpenRef.current = onOpen
  })

  useEffect(() => {
    if (!jobId || !openRequest || openRequest.jobId !== jobId) return
    if (openRequest.nonce === handledNonce.current) return
    handledNonce.current = openRequest.nonce
    onOpenRef.current()
  }, [openRequest, jobId])
}
