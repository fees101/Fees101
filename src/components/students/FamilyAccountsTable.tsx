'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { FamilyAccountRow, FamilyDvaFilter } from '@/lib/queries/families'
import { toggleFamilyDva } from '@/app/(app)/students/[id]/actions'
import { useCan } from '@/lib/auth/PermissionsProvider'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'
import Toast from '@/components/ui/Toast'
import FamilyAccountDrawer from '@/components/students/FamilyAccountDrawer'

interface Props {
  rows: FamilyAccountRow[]
  total: number
  page: number
  perPage: number
  counts: { all: number; on: number; off: number }
  filter: FamilyDvaFilter
  search: string
}

const PAGE_SIZE_OPTIONS = [25, 50, 100]
const GRID = 'minmax(22px,22px) minmax(160px,2fr) minmax(90px,0.8fr) minmax(80px,0.8fr) minmax(120px,1.1fr) minmax(90px,1fr) minmax(72px,0.7fr)'

function familyLabel(f: FamilyAccountRow): string {
  return f.primaryParentName || 'Unnamed family'
}

// Phase 7 (ROADMAP.md, Family-level DVA) — first school-wide view of which
// families use a shared account. Opening a single family (View) drops into
// FamilyAccountDrawer, a right-side panel showing its children and the
// on/off action in context, rather than acting blind from a bare row button.
// A multi-select batch skips the drawer and goes straight to a confirm step
// here, since bulk turn-off is already a deliberate, itemized action.
export default function FamilyAccountsTable({ rows, total, page, perPage, counts, filter, search }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const canManage = useCan('manage-students')
  const [searchInput, setSearchInput] = useState(search)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [pendingOff, setPendingOff] = useState<FamilyAccountRow[] | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null)
  const [viewing, setViewing] = useState<FamilyAccountRow | null>(null)

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams({ filter, q: search, page: String(page), perPage: String(perPage), ...patch })
    for (const key of Array.from(params.keys())) {
      if (!params.get(key) || params.get(key) === 'all') params.delete(key)
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) navigate({ q: searchInput, page: '1' })
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => { setSelected(new Set()) }, [rows])

  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, total)

  const chip = (value: FamilyDvaFilter, label: string, count: number) => (
    <button
      key={value}
      onClick={() => navigate({ filter: value, page: '1' })}
      data-active={filter === value}
      className="m-filter-chip m-num"
    >
      {label} {count.toLocaleString('en-NG')}
    </button>
  )

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allOnPageSelected = rows.length > 0 && rows.every(f => selected.has(f.id))
  function toggleSelectAll() {
    setSelected(prev => {
      if (allOnPageSelected) return new Set()
      const next = new Set(prev)
      rows.forEach(f => next.add(f.id))
      return next
    })
  }

  async function turnOnBulk(ids: string[]) {
    setBusyIds(prev => new Set([...prev, ...ids]))
    let failures = 0
    for (const id of ids) {
      const result = await toggleFamilyDva(id, true)
      if ('error' in result) failures++
    }
    setBusyIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.delete(id))
      return next
    })
    setSelected(new Set())
    setToast(failures > 0
      ? { ok: false, message: `${ids.length - failures} of ${ids.length} turned on — ${failures} failed.` }
      : { ok: true, message: ids.length === 1 ? 'Account turned on.' : `${ids.length} accounts turned on.` })
    router.refresh()
  }

  async function confirmTurnOffBulk() {
    if (!pendingOff) return
    setConfirmBusy(true)
    let failures = 0
    for (const f of pendingOff) {
      const result = await toggleFamilyDva(f.id, false)
      if ('error' in result) failures++
    }
    setConfirmBusy(false)
    setPendingOff(null)
    setSelected(new Set())
    setToast(failures > 0
      ? { ok: false, message: `${pendingOff.length - failures} of ${pendingOff.length} turned off — ${failures} failed.` }
      : { ok: true, message: pendingOff.length === 1 ? 'Account turned off.' : `${pendingOff.length} accounts turned off.` })
    router.refresh()
  }

  const selectedRows = rows.filter(f => selected.has(f.id))
  const selectedOn = selectedRows.filter(f => f.dvaEnabled)
  const selectedOff = selectedRows.filter(f => !f.dvaEnabled)

  return (
    <div className="px-4 sm:px-7 py-7">
      <p className="text-[14px] text-[var(--color-neutral-800)] mb-5" style={{ maxWidth: '60ch' }}>
        Every family with 2 or more children currently enrolled — a lone child can&apos;t use a shared account, so
        single-child families aren&apos;t listed here.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {chip('all', 'All', counts.all)}
        {chip('on', 'On', counts.on)}
        {chip('off', 'Off', counts.off)}
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Parent name or phone"
          className="m-input ml-auto"
          style={{ minWidth: 220 }}
        />
      </div>

      {canManage && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4 p-3" style={{ background: 'var(--color-neutral-200)' }}>
          <span className="text-[13px] font-semibold text-[var(--color-ink)]">{selectedRows.length} selected</span>
          {selectedOff.length > 0 && (
            <button onClick={() => turnOnBulk(selectedOff.map(f => f.id))} disabled={busyIds.size > 0} className="m-btn m-btn-outline m-btn-sm">
              Turn on {selectedOff.length}
            </button>
          )}
          {selectedOn.length > 0 && (
            <button onClick={() => setPendingOff(selectedOn)} disabled={busyIds.size > 0} className="m-btn m-btn-outline m-btn-sm">
              Turn off {selectedOn.length}
            </button>
          )}
        </div>
      )}

      {total === 0 ? (
        <div className="py-12 border-t-2 border-[var(--color-ink)]" style={{ maxWidth: '60ch' }}>
          <p className="text-[17px] font-bold text-[var(--color-ink)] mb-2">No families match this filter</p>
          <p className="text-[14px] leading-[1.55] text-[var(--color-neutral-800)]">
            Once a family with 2+ children turns on a shared account, or if you clear this filter, they&apos;ll show up here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid gap-2.5 pb-2 items-center border-b-2 border-[var(--color-ink)]"
            style={{ gridTemplateColumns: GRID, minWidth: 660 }}
          >
            {canManage ? (
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll} className="accent-[var(--color-ink)]" aria-label="Select all on this page" />
            ) : <span />}
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">FAMILY</span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">CHILDREN</span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">ACCOUNT</span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">NUMBER</span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]">BANK</span>
            <span className="text-right text-[11px] font-semibold tracking-[0.1em] text-[var(--color-neutral-700)]"></span>
          </div>

          {rows.map(f => (
            <div
              key={f.id}
              className="grid gap-2.5 items-center"
              style={{ gridTemplateColumns: GRID, minWidth: 660, padding: '12px 0', borderBottom: '1px solid var(--color-neutral-300)' }}
            >
              {canManage ? (
                <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelected(f.id)} className="accent-[var(--color-ink)]" aria-label={`Select ${familyLabel(f)}`} />
              ) : <span />}
              <div style={{ minWidth: 0 }}>
                <p className="text-[14px] font-semibold text-[var(--color-ink)]">{familyLabel(f)}</p>
                <p className="m-num text-[12px] mt-0.5 text-[var(--color-neutral-700)]">{f.primaryParentPhone || '—'}</p>
              </div>
              <span className="m-num text-[13px] text-[var(--color-neutral-800)]">{f.childCount}</span>
              <span
                className="text-[12px] font-semibold tracking-[0.06em]"
                style={{ color: f.dvaEnabled ? 'var(--color-ledger)' : 'var(--color-neutral-500)' }}
              >
                {f.dvaEnabled ? 'ON' : 'OFF'}
              </span>
              <span className="m-num text-[13px] text-[var(--color-ink)]">{f.accountNumber || '—'}</span>
              <span className="text-[13px] text-[var(--color-neutral-800)]">{f.bankName || '—'}</span>
              <div className="text-right">
                <button
                  onClick={() => setViewing(f)}
                  className="text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] hover:underline whitespace-nowrap"
                >
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
          <span className="m-num text-[13px] text-[var(--color-neutral-700)]">
            Showing {rangeStart}&ndash;{rangeEnd} of {total}
          </span>
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-2.5">
              <span className="text-[12px] text-[var(--color-neutral-700)]">Show</span>
              {PAGE_SIZE_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => navigate({ perPage: String(n), page: '1' })}
                  className="m-num"
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: perPage === n ? 700 : 400, color: perPage === n ? 'var(--color-ink)' : 'var(--color-neutral-500)' }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => navigate({ page: String(page - 1) })}
                disabled={page <= 1}
                className="text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ padding: '9px 10px' }}
              >
                Prev
              </button>
              <span className="m-num text-[13px] px-1.5">{page} / {totalPages}</span>
              <button
                onClick={() => navigate({ page: String(page + 1) })}
                disabled={page >= totalPages}
                className="text-[13px] font-semibold text-[var(--color-neutral-700)] hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ padding: '9px 10px' }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <FamilyAccountDrawer family={viewing} canManage={canManage} onClose={() => { setViewing(null); router.refresh() }} />
      )}

      {pendingOff && (
        <DestructiveConfirmModal
          eyebrow="This closes the account"
          title={pendingOff.length === 1 ? 'Turn off the family account' : `Turn off ${pendingOff.length} family accounts`}
          description="Each account is closed at the bank, not just hidden here — it stops accepting transfers immediately. Any payment already made through it stays on record."
          rows={pendingOff.slice(0, 8).map(f => ({
            label: familyLabel(f),
            value: f.accountNumber || '—',
          })).concat(pendingOff.length > 8 ? [{ label: `+${pendingOff.length - 8} more`, value: '' }] : [])}
          note="Turning any of these back on later creates a new account with a different number — the closed one doesn't come back."
          actions={[
            { label: 'Cancel', onClick: () => setPendingOff(null), variant: 'outline', disabled: confirmBusy },
            { label: confirmBusy ? 'Closing...' : (pendingOff.length === 1 ? 'Turn off' : `Turn off ${pendingOff.length}`), onClick: confirmTurnOffBulk, variant: 'danger', disabled: confirmBusy },
          ]}
        />
      )}

      {toast && <Toast ok={toast.ok} message={toast.message} onDismiss={() => setToast(null)} />}
    </div>
  )
}
