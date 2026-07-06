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

function statusBadgeClasses(status: 'draft' | 'active' | 'closed') {
  if (status === 'active') return 'bg-mint-light text-mint'
  if (status === 'draft') return 'bg-amber-50 text-amber-700'
  return 'bg-gray-100 text-gray-500'
}

function statusDot(status: 'draft' | 'active' | 'closed') {
  if (status === 'active') return 'bg-mint'
  if (status === 'draft') return 'bg-amber-500'
  return 'bg-gray-400'
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
      <Link
        href="/fees/cycles"
        className="px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90"
      >
        + Create first term
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 min-w-[280px]"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${statusDot(current.status)}`}></span>
        <span className="text-navy font-medium flex-1 text-left">{current.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadgeClasses(current.status)}`}>
          {current.status}
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-[360px] bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto">

          {Object.entries(grouped).map(([sessionName, sessionCycles]) => (
            <div key={sessionName}>
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 sticky top-0">
                <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">{sessionName}</p>
              </div>
              {sessionCycles.map(c => (
                <button
                  key={c.id}
                  onClick={() => selectCycle(c.id)}
                  className={`w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-gray-50 ${
                    c.id === current.id ? 'bg-mint-light/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(c.status)}`}></span>
                    <span className="text-sm text-navy truncate text-left">{c.name}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusBadgeClasses(c.status)}`}>
                    {c.status}
                  </span>
                </button>
              ))}
            </div>
          ))}

          {ungrouped.length > 0 && (
            <div>
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">No session</p>
              </div>
              {ungrouped.map(c => (
                <button
                  key={c.id}
                  onClick={() => selectCycle(c.id)}
                  className={`w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-gray-50 ${
                    c.id === current.id ? 'bg-mint-light/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(c.status)}`}></span>
                    <span className="text-sm text-navy truncate text-left">{c.name}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusBadgeClasses(c.status)}`}>
                    {c.status}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-gray-100 sticky bottom-0 bg-white">
            <Link
              href="/fees/cycles"
              className="flex items-center gap-2 px-3 py-3 hover:bg-gray-50 text-sm text-mint font-medium"
              onClick={() => setOpen(false)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Manage terms & sessions
            </Link>
          </div>

        </div>
      )}
    </div>
  )
}