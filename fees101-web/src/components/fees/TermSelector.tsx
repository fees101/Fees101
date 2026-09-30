'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { CycleRow } from '@/lib/queries/fees'

interface Props {
  cycles: CycleRow[]
  currentCycleId: string | null
  paramName?: string
}

function statusColor(status: 'draft' | 'active' | 'closed') {
  if (status === 'active') return 'var(--color-ink)'
  if (status === 'draft') return 'var(--color-ochre-text)'
  return 'var(--color-neutral-500)'
}

export default function TermSelector({ cycles, currentCycleId, paramName = 'cycle' }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const current = cycles.find(c => c.id === currentCycleId)
    || cycles.find(c => c.status === 'active')
    || cycles.find(c => c.status === 'draft')
    || cycles[0]

  const grouped: Record<string, CycleRow[]> = {}
  const ungrouped: CycleRow[] = []

  cycles.forEach(c => {
    if (c.sessionName) {
      if (!grouped[c.sessionName]) grouped[c.sessionName] = []
      grouped[c.sessionName].push(c)
    } else {
      ungrouped.push(c)
    }
  })

  // Sort cycles within each group: active first, then draft, then closed
  function sortByStatus(a: CycleRow, b: CycleRow) {
    const order = { active: 0, draft: 1, closed: 2 }
    return order[a.status] - order[b.status]
  }
  Object.keys(grouped).forEach(k => grouped[k].sort(sortByStatus))
  ungrouped.sort(sortByStatus)

  function selectCycle(cycleId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set(paramName, cycleId)
    router.replace(`${pathname}?${params.toString()}`)
    setOpen(false)
  }

  if (!current) {
    return (
      <Link href="/fees/cycles" className="m-btn m-btn-primary">
        + Create first term
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 border border-[var(--color-neutral-300)] text-sm hover:border-[var(--color-ink)] min-w-[240px] sm:min-w-[280px]"
      >
        <span className="text-[var(--color-ink)] font-medium flex-1 text-left truncate">{current.name}</span>
        <span className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.08em', color: statusColor(current.status) }}>{current.status}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-neutral-500)] flex-shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-[min(360px,90vw)] bg-[var(--color-paper)] border-2 border-[var(--color-ink)] z-50 max-h-[400px] overflow-y-auto m-anim-scale">

          {Object.entries(grouped).map(([sessionName, sessionCycles]) => (
            <div key={sessionName}>
              <div className="px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-neutral-300)] sticky top-0">
                <p className="text-[11px] text-[var(--color-neutral-700)] uppercase tracking-wider font-semibold">{sessionName}</p>
              </div>
              {sessionCycles.map(c => (
                <button
                  key={c.id}
                  onClick={() => selectCycle(c.id)}
                  className={`w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-[var(--color-surface)] border-b border-[var(--color-neutral-300)] last:border-0 ${
                    c.id === current.id ? 'bg-[var(--color-surface)]' : ''
                  }`}
                >
                  <span className="text-sm text-[var(--color-ink)] truncate text-left flex-1">{c.name}</span>
                  <span className="text-xs font-semibold uppercase flex-shrink-0" style={{ letterSpacing: '0.08em', color: statusColor(c.status) }}>{c.status}</span>
                </button>
              ))}
            </div>
          ))}

          {ungrouped.length > 0 && (
            <div>
              <div className="px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-neutral-300)]">
                <p className="text-[11px] text-[var(--color-neutral-700)] uppercase tracking-wider font-semibold">No session</p>
              </div>
              {ungrouped.map(c => (
                <button
                  key={c.id}
                  onClick={() => selectCycle(c.id)}
                  className={`w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-[var(--color-surface)] border-b border-[var(--color-neutral-300)] last:border-0 ${
                    c.id === current.id ? 'bg-[var(--color-surface)]' : ''
                  }`}
                >
                  <span className="text-sm text-[var(--color-ink)] truncate text-left flex-1">{c.name}</span>
                  <span className="text-xs font-semibold uppercase flex-shrink-0" style={{ letterSpacing: '0.08em', color: statusColor(c.status) }}>{c.status}</span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t-2 border-[var(--color-ink)] sticky bottom-0 bg-[var(--color-paper)]">
            <Link
              href="/fees/cycles"
              className="flex items-center gap-2 px-3 py-3 hover:bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-ink)]"
              onClick={() => setOpen(false)}
            >
              Manage terms &amp; sessions
            </Link>
          </div>

        </div>
      )}
    </div>
  )
}
