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

export type TrackedJobType = 'invoice_generation' | 'invoice_regeneration' | 'csv_import' | 'bulk_dva' | 'bulk_send' | 'close_term'

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

// Exported so the logout handler can clear it for the next person to use this
// browser (e.g. a shared front-desk computer) — see UserMenu.tsx.
export const ACTIVE_JOBS_STORAGE_KEY = 'fees101_active_jobs'
const STORAGE_KEY = ACTIVE_JOBS_STORAGE_KEY

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

// A job the (app) layout found server-side — either still 'running' with no
// browser tracking it (different device, or this one after a hard reload),
// or 'failed'/interrupted with its owning tab long gone. See (app)/layout.tsx.
export interface InterruptedJob {
  jobId: string
  jobType: TrackedJobType
  label: string
  processed: number
  total: number
  status: 'running' | 'failed'
  failed?: number
  error?: string | null
  href?: string
}

export function ActiveJobsProvider({ children, interruptedJobs = [] }: { children: React.ReactNode; interruptedJobs?: InterruptedJob[] }) {
  const [jobs, setJobs] = useState<Record<string, TrackedJob>>({})
  // Failed/interrupted jobs surfaced from the server, not yet dismissed by
  // the user in this session. Separate from `jobs` (which is for live-tracked
  // running jobs) since these were never polled here and have no progress to
  // keep advancing — this is a one-time notice, not a chip.
  const [failedNotices, setFailedNotices] = useState<InterruptedJob[]>(
    interruptedJobs.filter(j => j.status === 'failed')
  )
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
      setJobs(prev => {
        // A status-reader fetch already in flight when the driver loop
        // completes resolves AFTER .then() has set the terminal status —
        // and this callback hardcodes 'running'. Left unguarded, that late
        // tick clobbers a completed/failed/cancelled job back to 'running',
        // so its chip (and the "N hidden jobs running" pill, both filtered on
        // status==='running') stay up until a page reload. Never downgrade a
        // job that's already terminal.
        const existing = prev[jobId]
        if (existing && existing.status !== 'running') return prev
        return {
          ...prev,
          [jobId]: {
            jobId, jobType, label, processed: s.processed, total: s.total, status: 'running',
            meta: meta ?? existing?.meta,
            cancelling: existing?.cancelling,
          },
        }
      })
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
            { id: jobId, ok: true, message: `${label} complete - ${final.processed}${final.total ? `/${final.total}` : ''}${failedNote}` },
          ])
        } else if (final.status === 'failed') {
          setToasts(t => [...t, { id: jobId, ok: false, message: `${label} failed - ${final.error || 'something went wrong'}` }])
        } else if (final.status === 'cancelled') {
          setToasts(t => [...t, { id: jobId, ok: false, message: `${label} cancelled - ${final.processed}${final.total ? `/${final.total}` : ''} done` }])
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
    // Also reattach any still-running job the server found but this browser
    // has no localStorage record of (a different device, or this one after
    // clearing storage) — dedupes against the loop above via drive()'s own
    // polling.current guard.
    for (const j of interruptedJobs) {
      if (j.status !== 'running') continue
      drive(j.jobId, j.jobType, j.label, j.href ? { href: j.href } : undefined)
    }
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

  // "I've seen this, stop showing it" — persists via the acknowledge route so
  // a hard reload doesn't bring the same notice straight back.
  const dismissFailedNotice = useCallback((jobId: string) => {
    setFailedNotices(prev => prev.filter(j => j.jobId !== jobId))
    fetch('/api/jobs/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(() => {
      // best-effort — worst case the notice reappears on the next reload
    })
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
        {failedNotices.map(j => (
          <div key={j.jobId} className="pointer-events-auto max-w-sm">
            <div className="flex items-start gap-3 p-4 bg-[var(--color-ink)] text-[var(--color-paper)] border-l-[5px] border-[var(--color-signal)] m-anim-slab">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">
                  {j.label} stopped after {j.processed}{j.total ? ` of ${j.total}` : ''}
                </p>
                <p className="text-xs text-[var(--color-neutral-400)] mt-0.5 m-num">
                  Resume from {j.processed + 1}{j.failed ? ` · ${j.failed} failed` : ''}
                  {j.error ? ` · ${j.error}` : ''}
                </p>
                {j.href && (
                  <a href={j.href} className="text-xs font-semibold text-[var(--color-paper)] hover:underline mt-1 inline-block">
                    Go review
                  </a>
                )}
              </div>
              <button
                onClick={() => dismissFailedNotice(j.jobId)}
                aria-label="Dismiss"
                className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-400)] hover:text-[var(--color-paper)] flex-shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
        {hiddenRunningJobs.length > 0 && (
          <button
            onClick={restoreHiddenChips}
            className="pointer-events-auto flex items-center gap-2.5 px-3 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs font-semibold hover:bg-[var(--color-neutral-900)]"
          >
            <span className="m-loading w-7 flex-shrink-0" />
            {hiddenRunningJobs.length} hidden job{hiddenRunningJobs.length === 1 ? '' : 's'} running - Show
          </button>
        )}
        {runningJobs.map(j => {
          const pct = j.total > 0 ? Math.min(100, Math.round((j.processed / j.total) * 100)) : 0
          const inner = (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">
                  {j.cancelling ? 'Cancelling...' : j.label}
                </p>
                {j.total > 0 ? (
                  <div className="w-44 h-0.5 bg-[var(--color-neutral-800)] overflow-hidden mt-2">
                    <div className="h-full bg-[var(--color-paper)]" style={{ width: `${pct}%`, transition: 'width var(--dur-settle) var(--ease-out)' }} />
                  </div>
                ) : (
                  <div className="w-44 mt-2 m-loading" />
                )}
                <p className="text-[11px] text-[var(--color-neutral-400)] mt-1 m-num">{j.processed}/{j.total || '?'}</p>
              </div>
              {!j.cancelling && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelJob(j.jobId) }}
                  aria-label="Cancel"
                  title="Cancel this job"
                  className="px-2 py-1 -m-1 text-xs font-semibold text-[var(--color-signal-500)] hover:text-[var(--color-signal-400)] flex-shrink-0"
                >
                  Cancel
                </button>
              )}
              {/* Hides the chip only. The job keeps running/polling in the
                  background. Distinct from Cancel above, which stops the job
                  itself, kept as its own small "x" so the two actions (stop the
                  job vs. stop watching it) stay visually and functionally
                  separate. */}
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); hideChip(j.jobId) }}
                aria-label="Hide"
                title="Hide (keeps running in the background)"
                className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] hover:text-[var(--color-paper)] flex-shrink-0"
              >
                Hide
              </button>
            </>
          )
          const cls = 'pointer-events-auto flex items-center gap-3 p-4 bg-[var(--color-ink)] text-[var(--color-paper)] border-l-[5px] border-[var(--color-neutral-600)] max-w-sm m-anim-slab'
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
            <div className={`flex items-start gap-3 p-4 bg-[var(--color-ink)] text-[var(--color-paper)] border-l-[5px] m-anim-slab ${t.ok ? 'border-[var(--color-paper)]' : 'border-[var(--color-signal)]'}`}>
              <p className="text-sm flex-1 m-num">{t.message}</p>
              <button
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss"
                className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-400)] hover:text-[var(--color-paper)] flex-shrink-0"
              >
                Dismiss
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
