'use client'

import { useRouter, useSearchParams } from 'next/navigation'

// Client component because the Money oversight page has three independent
// filter forms sharing one URL (refunds/manual/discounts, each with its own
// `${prefix}Status` etc params). A plain <form method="get"> would replace
// the whole query string with just its own fields on submit, wiping the
// other two tabs' filters — this merges into the existing searchParams
// instead, the same way the Prev/Next links already do via buildQuery.

const fieldStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  color: 'var(--ink)',
  fontFamily: 'var(--font)',
  fontSize: 13,
}

export default function MoneyFilterForm({
  tabKey,
  prefix,
  schools,
  statusOptions,
  status,
  schoolId,
  from,
  to,
}: {
  tabKey: string
  prefix: string
  schools: { id: string; name: string }[]
  statusOptions: string[]
  status?: string
  schoolId?: string
  from?: string
  to?: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tabKey)
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) params.set(k, v)
      else params.delete(k)
    })
    params.delete(`${prefix}Page`)
    router.push(`?${params.toString()}`)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    update({
      [`${prefix}Status`]: String(fd.get('status') || ''),
      [`${prefix}School`]: String(fd.get('school') || ''),
      [`${prefix}From`]: String(fd.get('from') || ''),
      [`${prefix}To`]: String(fd.get('to') || ''),
    })
  }

  function clear() {
    update({
      [`${prefix}Status`]: undefined,
      [`${prefix}School`]: undefined,
      [`${prefix}From`]: undefined,
      [`${prefix}To`]: undefined,
    })
  }

  const hasFilters = !!(status || schoolId || from || to)

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, padding: '12px 16px', flexWrap: 'wrap', alignItems: 'flex-end', borderBottom: '2px solid var(--rule)' }}>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>Status</label>
        <select name="status" defaultValue={status || ''} style={fieldStyle}>
          <option value="">All statuses</option>
          {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>School</label>
        <select name="school" defaultValue={schoolId || ''} style={fieldStyle}>
          <option value="">All schools</option>
          {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>From</label>
        <input type="date" name="from" defaultValue={from || ''} style={fieldStyle} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>To</label>
        <input type="date" name="to" defaultValue={to || ''} style={fieldStyle} />
      </div>
      <button type="submit" className="btn btn-primary">Filter</button>
      {hasFilters && <button type="button" onClick={clear} className="btn btn-ghost">Clear</button>}
    </form>
  )
}
