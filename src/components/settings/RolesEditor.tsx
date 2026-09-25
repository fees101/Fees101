'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PermissionDef } from '@/lib/auth/permissionCatalog'
import { createRole, saveRolePermissions, renameRole, deleteRole } from '@/app/(app)/team/roles-permissions/actions'
import Toast from '@/components/ui/Toast'
import { toCSV } from '@/lib/reports/csv'
import { SectionLabel, ChoiceList, CheckList } from '@/components/settings/FieldEditDrawer'

interface RoleRow {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  isAdmin: boolean
  permissions: Record<string, boolean>
  assignedCount: number
}

interface Props {
  roles: RoleRow[]
  catalog: PermissionDef[]
  ownRoleId: string | null
  isOwner: boolean
}

export default function RolesEditor({ roles, catalog, ownRoleId, isOwner }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [renamingRoleId, setRenamingRoleId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null)

  // Optimistic per-role permission map, keyed by role id. Kept in sync with the
  // server truth whenever fresh props arrive (own save via router.refresh, or
  // another admin's change via RealtimeRefresh).
  const [permsByRole, setPermsByRole] = useState<Record<string, Record<string, boolean>>>(() =>
    Object.fromEntries(roles.map(r => [r.id, { ...r.permissions }]))
  )
  useEffect(() => {
    setPermsByRole(Object.fromEntries(roles.map(r => [r.id, { ...r.permissions }])))
  }, [roles])

  const seePerms = catalog.filter(p => p.group === 'SEE')
  const doPerms = catalog.filter(p => p.group === 'DO')

  // Administrator is implicitly all-on and not editable; your own role is locked
  // separately so manage-team can't be used to self-escalate; and only the owner
  // can change what any role is allowed to do at all — otherwise a manage-team
  // holder could grant a second, colluding account full access without ever
  // touching is_admin or their own role. Anyone who reached this page can still
  // SEE what a role grants even when they can't edit it.
  const canEditRole = (role: RoleRow) => isOwner && !role.isAdmin && role.id !== ownRoleId

  async function toggleCell(role: RoleRow, key: string) {
    if (!canEditRole(role)) return
    const current = permsByRole[role.id] || {}
    const granting = !current[key]
    const next = { ...current, [key]: granting }
    setPermsByRole(p => ({ ...p, [role.id]: next }))
    setError(null); setNotice(null)
    const result = await saveRolePermissions(role.id, next)
    if (result.error) {
      // Revert the optimistic flip and surface the failure.
      setPermsByRole(p => ({ ...p, [role.id]: current }))
      setError(result.error)
      return
    }
    const label = catalog.find(p => p.key === key)?.label
    setNotice(label ? `${role.name}: ${label} ${granting ? 'granted' : 'removed'}.` : 'Permission updated.')
    router.refresh()
  }

  // Export the matrix exactly as read on screen — one row per permission, one
  // column per role. Owner/admin columns read "bypass" (they clear every check
  // regardless of the switch). Pure client-side: no PII, no money, just the
  // role names and booleans already loaded on the page.
  function exportMatrix() {
    const headers = ['Permission', 'Group', ...roles.map(r => r.name)]
    const rows = catalog.map(perm => [
      perm.label,
      perm.group,
      ...roles.map(role =>
        role.isAdmin ? 'bypass' : permsByRole[role.id]?.[perm.key] ? 'yes' : 'no'
      ),
    ])
    const blob = new Blob([toCSV(headers, rows)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `roles-matrix-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setNotice('Matrix exported.')
  }

  const gridTemplateColumns = `minmax(220px, 1.6fr) repeat(${roles.length}, minmax(88px, 1fr))`
  // Keep columns from crushing on narrow screens; the matrix is the one element
  // allowed to scroll horizontally.
  const minWidth = 240 + roles.length * 100

  const cellPad = '9px 0'
  const dotCell: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: cellPad }

  // Grant marks are text glyphs, not CSS-drawn shapes — zero border-radius
  // stays true even for the densest surface in the product. A filled square
  // for granted, hollow for owner/admin's automatic bypass, an en-dash for
  // not granted.
  function Mark({ glyph, color }: { glyph: string; color: string }) {
    return <span aria-hidden style={{ color, fontSize: 13, lineHeight: 1 }}>{glyph}</span>
  }

  function Cell({ role, perm }: { role: RoleRow; perm: PermissionDef }) {
    const editable = canEditRole(role)
    const granted = role.isAdmin ? true : !!(permsByRole[role.id]?.[perm.key])
    // Owner/admin roles clear every check by bypass, so their grants aren't
    // "doing the work" — a hollow square in neutral, never a filled or
    // signal-red mark. Shape carries the meaning: filled = granted by a
    // switch, hollow = granted by bypass, en-dash = not granted.
    const content = role.isAdmin
      ? <Mark glyph="□" color="var(--color-neutral-500)" />
      : granted
        ? <Mark glyph="■" color="var(--color-ink)" />
        : <Mark glyph="–" color="var(--color-neutral-500)" />
    const status = role.isAdmin ? 'granted by owner bypass' : granted ? 'granted' : 'not granted'

    if (!editable) {
      return (
        <div style={dotCell} role="img" aria-label={`${role.name}: ${perm.label} — ${status}`}>
          {content}
        </div>
      )
    }
    return (
      <button
        type="button"
        onClick={() => toggleCell(role, perm.key)}
        aria-pressed={granted}
        aria-label={`${role.name}: ${perm.label} — ${granted ? 'granted, click to remove' : 'not granted, click to grant'}`}
        style={{ ...dotCell, width: '100%', background: 'transparent', border: 0, cursor: 'pointer' }}
      >
        {content}
      </button>
    )
  }

  async function submitRename(role: RoleRow) {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === role.name) { setRenamingRoleId(null); return }
    setBusyRoleId(role.id)
    setError(null); setNotice(null)
    const result = await renameRole(role.id, trimmed, role.description || undefined)
    setBusyRoleId(null)
    setRenamingRoleId(null)
    if (result.error) { setError(result.error); return }
    setNotice(`Renamed "${role.name}" to "${trimmed}".`)
    router.refresh()
  }

  async function handleDelete(role: RoleRow) {
    if (role.assignedCount > 0) {
      setError('This role is still assigned to staff. Reassign them to another role first.')
      return
    }
    if (!window.confirm(`Delete the role "${role.name}"? This can't be undone.`)) return
    setBusyRoleId(role.id)
    setError(null); setNotice(null)
    const result = await deleteRole(role.id)
    setBusyRoleId(null)
    if (result.error) { setError(result.error); return }
    setNotice(`Role "${role.name}" deleted.`)
    router.refresh()
  }

  function Rule({ weight, color }: { weight: number; color: string }) {
    return <div style={{ gridColumn: '1 / -1', borderBottom: `${weight}px solid ${color}` }} />
  }

  function PermRow({ perm }: { perm: PermissionDef }) {
    return (
      <>
        <div style={{ padding: cellPad, fontSize: 14, color: 'var(--color-ink)', display: 'flex', alignItems: 'center' }}>
          {perm.label}
        </div>
        {roles.map(role => <Cell key={role.id} role={role} perm={perm} />)}
        <Rule weight={1} color="var(--color-neutral-300)" />
      </>
    )
  }

  function GroupHeader({ label }: { label: string }) {
    return (
      <div
        style={{
          gridColumn: '1 / -1',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--color-ink)',
          padding: '18px 0 6px',
        }}
      >
        {label}
      </div>
    )
  }

  return (
    <div>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Who can do what
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          Twenty-one permissions across {roles.length} {roles.length === 1 ? 'role' : 'roles'} — the densest surface in
          the product. The catalog splits in two: {seePerms.length === 9 ? 'nine' : seePerms.length} SEE keys govern what
          a role can look at, {doPerms.length === 12 ? 'twelve' : doPerms.length} DO keys govern what it can change. Owner
          bypasses every switch and cannot be edited.
        </p>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          Read down a column to understand a role, across a row to see who holds a power. A filled square is granted, a
          dash is not.
        </p>
      </div>

      {/* Context notes — same three the App Shell canvas carries: roles belong
          to the school, owner is a bypass (why its column reads hollow), and a
          flipped switch takes effect on the next request. Left-rule, no fill. */}
      <div
        style={{ borderLeft: '2px solid var(--color-ink)', paddingLeft: 14, marginTop: 16, maxWidth: '74ch', display: 'grid', gap: 6 }}
      >
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ margin: 0, lineHeight: 1.55 }}>
          <strong className="font-semibold text-[var(--color-ink)]">Roles are the school&rsquo;s own, not ours.</strong>{' '}
          There is no fixed set — a school creates as many as it needs, and each one is these same {catalog.length}{' '}
          switches.
        </p>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ margin: 0, lineHeight: 1.55 }}>
          <strong className="font-semibold text-[var(--color-ink)]">Owner is a bypass, not a column of grants.</strong>{' '}
          A role flagged as owner clears every check regardless of its switches, so its marks are shown hollow — they are
          not doing the work.
        </p>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ margin: 0, lineHeight: 1.55 }}>
          <strong className="font-semibold text-[var(--color-ink)]">Changes land on the next click.</strong> Permissions
          are read per request, so a switch flipped here reaches that person without them signing out.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
        {isOwner && (
          <button
            onClick={() => { setShowCreate(true); setError(null); setNotice(null) }}
            className="m-btn m-btn-primary"
          >
            Add a role
          </button>
        )}
        <button onClick={exportMatrix} className="m-btn m-btn-outline">
          Export this matrix
        </button>
      </div>

      {/* Matrix — the one element allowed to scroll horizontally. Sits directly on
          the paper ground, structured by rules (no card, no border box). */}
      <div style={{ overflowX: 'auto', marginTop: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns, columnGap: 12, minWidth }}>
          {/* Column header row */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--color-neutral-700)',
              paddingBottom: 10,
              display: 'flex',
              alignItems: 'flex-end',
            }}
          >
            Permission
          </div>
          {roles.map(role => (
            <div
              key={role.id}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--color-ink)',
                textAlign: 'center',
                paddingBottom: 10,
                alignSelf: 'flex-end',
              }}
            >
              {renamingRoleId === role.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitRename(role); if (e.key === 'Escape') setRenamingRoleId(null) }}
                    className="m-input"
                    style={{ width: '100%', fontSize: 13, textAlign: 'center', padding: '4px 6px' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 8, fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    <button onClick={() => submitRename(role)} disabled={busyRoleId === role.id} className="hover:underline" style={{ color: 'var(--color-ink)' }}>Save</button>
                    <button onClick={() => setRenamingRoleId(null)} disabled={busyRoleId === role.id} className="hover:underline" style={{ color: 'var(--color-neutral-700)' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {role.name}
                  {isOwner && !role.isSystem && !role.isAdmin && (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>
                      <button
                        onClick={() => { setRenamingRoleId(role.id); setRenameValue(role.name); setError(null); setNotice(null) }}
                        disabled={busyRoleId === role.id}
                        className="hover:underline"
                        style={{ color: 'var(--color-neutral-700)' }}
                      >
                        Rename
                      </button>
                      <span style={{ color: 'var(--color-neutral-500)' }}>&middot;</span>
                      <button
                        onClick={() => handleDelete(role)}
                        disabled={busyRoleId === role.id}
                        className="hover:underline"
                        style={{ color: 'var(--color-neutral-700)' }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          <Rule weight={2} color="var(--color-ink)" />

          <GroupHeader label={`SEE — VISIBILITY · ${seePerms.length} KEYS`} />
          {seePerms.map(perm => <PermRow key={perm.key} perm={perm} />)}

          <GroupHeader label={`DO — ACTIONS · ${doPerms.length} KEYS`} />
          {doPerms.map(perm => <PermRow key={perm.key} perm={perm} />)}
        </div>
      </div>

      {showCreate && isOwner && (
        <CreateRoleDrawer
          roles={roles}
          catalog={catalog}
          onClose={() => setShowCreate(false)}
          onCreated={(name) => { setShowCreate(false); setNotice(`Role "${name}" created.`); router.refresh() }}
        />
      )}

      {!showCreate && (notice || error) && (
        <Toast
          message={(notice || error) as string}
          ok={!!notice}
          onDismiss={() => { setNotice(null); setError(null) }}
        />
      )}
    </div>
  )
}

// Right-edge drawer matching the App Shell canvas's "Create a role" — Role
// name, a "Start from" list that copies an existing (non-admin) role's grants
// as a starting point, then the same grouped SEE/DO checklist the matrix
// itself uses, with a live "N of 21 granted" count. Copying a role is just a
// starting point, not a link — every box stays individually editable after.
const NOTHING = '__nothing__'

function CreateRoleDrawer({
  roles, catalog, onClose, onCreated,
}: {
  roles: RoleRow[]
  catalog: PermissionDef[]
  onClose: () => void
  onCreated: (name: string) => void
}) {
  const copyable = roles.filter(r => !r.isAdmin)
  const [base, setBase] = useState<string>(copyable[0]?.id || NOTHING)
  const [name, setName] = useState('')
  const [granted, setGranted] = useState<string[]>(() => {
    const seed = copyable[0]
    return seed ? Object.keys(seed.permissions).filter(k => seed.permissions[k]) : []
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function chooseBase(v: string) {
    setBase(v)
    const seed = copyable.find(r => r.id === v)
    setGranted(seed ? Object.keys(seed.permissions).filter(k => seed.permissions[k]) : [])
  }

  const seePerms = catalog.filter(p => p.group === 'SEE')
  const doPerms = catalog.filter(p => p.group === 'DO')

  async function handleSubmit() {
    setError(null)
    if (!name.trim()) { setError('A role name is required'); return }
    setSaving(true)
    const permissions = Object.fromEntries(catalog.map(p => [p.key, granted.includes(p.key)]))
    const result = await createRole(name, undefined, permissions)
    setSaving(false)
    if (result.error) return setError(result.error)
    onCreated(name.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex m-anim-fade">
      <div className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]" onClick={onClose} />
      <aside
        style={{ width: '420px', maxWidth: '100%' }}
        className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
      >
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">Create a role</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
          >
            Close
          </button>
        </div>
        <p className="text-[13px] leading-relaxed mb-5 text-[var(--color-neutral-700)]">
          Roles are the only way permissions are granted — there are no per-person exceptions. Twenty-one keys, nine of
          them about what a person can see.
        </p>

        <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 16 }}>
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>Role name</SectionLabel>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Senior clerk"
              className="m-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              autoFocus
            />
            <p className="text-[12px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0', lineHeight: 1.45 }}>
              Staff see this name on their profile, so use the school&rsquo;s own word for the job.
            </p>
          </div>

          <div style={{ marginBottom: 18 }}>
            <SectionLabel>Start from</SectionLabel>
            <ChoiceList
              value={base}
              onChange={chooseBase}
              options={[
                { value: NOTHING, label: 'Start from nothing' },
                ...copyable.map(r => ({ value: r.id, label: `Copy ${r.name}` })),
              ]}
            />
            <p className="text-[12px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0', lineHeight: 1.45 }}>
              Copying is safer than starting empty — you adjust from a role that already works.
            </p>
          </div>

          <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 14, marginBottom: 18 }}>
            <div className="flex items-baseline justify-between gap-3" style={{ marginBottom: 10 }}>
              <p className="text-[11px] tracking-[0.14em]" style={{ color: 'var(--color-neutral-700)', margin: 0 }}>PERMISSIONS</p>
              <p className="m-num text-[12px] font-semibold" style={{ margin: 0 }}>{granted.length} of {catalog.length} granted</p>
            </div>

            <SectionLabel>{`SEE — VISIBILITY · ${seePerms.length} KEYS`}</SectionLabel>
            <div style={{ marginBottom: 14 }}>
              <CheckList
                value={granted}
                onChange={setGranted}
                options={seePerms.map(p => ({ value: p.key, label: p.label }))}
              />
            </div>

            <SectionLabel>{`DO — ACTIONS · ${doPerms.length} KEYS`}</SectionLabel>
            <CheckList
              value={granted}
              onChange={setGranted}
              options={doPerms.map(p => ({ value: p.key, label: p.label }))}
            />
          </div>

          <div style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 14, marginBottom: 18 }}>
            <p className="text-[12px]" style={{ margin: 0, lineHeight: 1.5, color: 'var(--color-neutral-700)' }}>
              Creating a role changes nothing on its own — no one holds it until you assign it from Users. Every grant
              is recorded in the audit log.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 text-sm text-[var(--color-signal-text)]" style={{ borderLeft: '3px solid var(--color-signal)' }}>
              {error}
            </div>
          )}

          <div className="flex items-center gap-[10px]">
            <button onClick={handleSubmit} disabled={saving} className="m-btn m-btn-primary" style={{ flex: 1 }}>
              {saving ? 'Creating...' : 'Create role'}
            </button>
            <button onClick={onClose} disabled={saving} className="m-btn m-btn-outline">Cancel</button>
          </div>
        </div>
      </aside>
    </div>
  )
}
