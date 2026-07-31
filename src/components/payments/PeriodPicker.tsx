'use client'

import { useState } from 'react'

interface Item { id: string; name: string; status?: string }

// Searchable multi-select for comparison — type to filter (so 20+ terms is no
// problem), tick up to `max`. Switch between comparing terms or whole sessions.
export function PeriodPicker({
  terms, sessions, type, onType, selected, onToggle, onClear, max = 5,
}: {
  terms: Item[]
  sessions: Item[]
  type: 'term' | 'session'
  onType: (t: 'term' | 'session') => void
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
  max?: number
}) {
  const [q, setQ] = useState('')
  const items = type === 'term' ? terms : sessions
  const filtered = q.trim()
    ? items.filter(i => i.name.toLowerCase().includes(q.trim().toLowerCase()))
    : items
  const atMax = selected.length >= max

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex rounded-lg border border-gray-200 p-0.5 text-xs font-medium">
          <button onClick={() => onType('term')}
            className={`px-3 py-1 rounded-md transition-colors ${type === 'term' ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'}`}>Terms</button>
          <button onClick={() => onType('session')}
            className={`px-3 py-1 rounded-md transition-colors ${type === 'session' ? 'bg-navy text-white' : 'text-gray-500 hover:text-navy'}`}>Sessions</button>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{selected.length}/{max} selected</span>
          {selected.length > 0 && (
            <button onClick={onClear} className="text-amber-600 hover:text-amber-800 font-medium">Clear</button>
          )}
        </div>
      </div>

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={`Search ${type}s…`}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-navy focus:border-mint focus:outline-none focus:ring-1 focus:ring-mint mb-3"
      />

      <div className="max-h-56 overflow-y-auto pr-1 space-y-1">
        {filtered.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No matches.</p>}
        {filtered.map(i => {
          const checked = selected.includes(i.id)
          const disabled = !checked && atMax
          return (
            <label
              key={i.id}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm cursor-pointer transition-colors ${
                checked ? 'bg-mint/10 text-navy' : disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onToggle(i.id)}
                className="accent-mint"
              />
              <span className="flex-1">{i.name}</span>
              {i.status === 'active' && <span className="text-xs text-mint font-medium">active</span>}
            </label>
          )
        })}
      </div>
      {atMax && <p className="mt-2 text-xs text-amber-600">Maximum {max} periods — untick one to swap.</p>}
    </div>
  )
}
