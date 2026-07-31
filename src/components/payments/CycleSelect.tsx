'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface CycleSelectProps {
  cycles: { id: string; name: string; status: string }[]
  selectedId: string
}

// Navigates to ?cycle=<id> on change so the server page re-renders the
// analytics for the chosen term — same searchParams-filter pattern the
// Students page uses for its status filter.
export default function CycleSelect({ cycles, selectedId }: CycleSelectProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('cycle', e.target.value)
    router.push(`/payments?${params.toString()}`)
  }

  return (
    <select
      value={selectedId}
      onChange={onChange}
      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-navy focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint"
    >
      {cycles.map(c => (
        <option key={c.id} value={c.id}>
          {c.name}{c.status === 'active' ? ' (active)' : ''}
        </option>
      ))}
    </select>
  )
}
