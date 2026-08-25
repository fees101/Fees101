'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PermissionDef } from '@/lib/auth/permissionCatalog'
import { createRole, renameRole, deleteRole, saveRolePermissions } from '@/app/(app)/settings/roles-permissions/actions'

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
  const [selectedId, setSelectedId] = useState(roles[0]?.id || '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const selected = roles.find(r => r.id === selectedId) || roles[0]

  const seePerms = catalog.filter(p => p.group === 'SEE')
  const doPerms = catalog.filter(p => p.group === 'DO')

  return (
    <div className="space-y-4">
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {notice && <div className="p-3 bg-mint-light border border-mint/30 rounded-lg text-sm text-navy">{notice}</div>}

      <div className="flex flex-col md:flex-row gap-5 items-start">
        {/* Role list */}
        <div className="w-full md:w-56 flex-shrink-0 space-y-1.5">
          {roles.map(r => (
            <button
              key={r.id}
              onClick={() => { setSelectedId(r.id); setError(null); setNotice(null) }}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                r.id === selected?.id ? 'border-mint bg-mint/5' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-navy truncate">{r.name}</span>
                {r.isAdmin && <span className="text-[10px] px-1.5 py-0.5 bg-navy/5 text-navy rounded-full">Full access</span>}
              </div>
              <span className="text-xs text-gray-400">{r.assignedCount} {r.assignedCount === 1 ? 'person' : 'people'}</span>
            </button>
          ))}
          {isOwner && (
            <button
              onClick={() => { setShowCreate(true); setError(null); setNotice(null) }}
              className="w-full text-left px-3 py-2.5 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:bg-gray-50"
            >
              + New role
            </button>
          )}
        </div>

        {/* Selected role editor */}
        {selected && (
          <RolePanel
            key={selected.id}
            role={selected}
            isOwnRole={selected.id === ownRoleId}
            isOwner={isOwner}
            seePerms={seePerms}
            doPerms={doPerms}
            onError={setError}
            onNotice={setNotice}
            onChanged={() => router.refresh()}
          />
        )}
      </div>

      {showCreate && isOwner && (
        <CreateRoleModal
          onClose={() => setShowCreate(false)}
          onError={setError}
          onCreated={(name) => { setShowCreate(false); setNotice(`Role “${name}” created.`); router.refresh() }}
        />
      )}
    </div>
  )
}

function RolePanel({
  role, isOwnRole, isOwner, seePerms, doPerms, onError, onNotice, onChanged,
}: {
  role: RoleRow
  isOwnRole: boolean
  isOwner: boolean
  seePerms: PermissionDef[]
  doPerms: PermissionDef[]
  onError: (s: string | null) => void
  onNotice: (s: string | null) => void
  onChanged: () => void
}) {
  const [perms, setPerms] = useState<Record<string, boolean>>({ ...role.permissions })
  const [saving, setSaving] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description || '')

  // Administrator is implicitly all-on and not editable; your own role is
  // locked separately so manage-team can't be used to self-escalate; and only
  // the owner can change what any role is allowed to do at all — otherwise a
  // manage-team holder could grant a second, colluding account full access
  // without ever touching is_admin or their own role.
  const locked = role.isAdmin || isOwnRole || !isOwner

  const dirty = !locked && JSON.stringify(perms) !== JSON.stringify({ ...role.permissions })

  function toggle(key: string) {
    if (locked) return
    setPerms(p => ({ ...p, [key]: !p[key] }))
  }

  async function handleSave() {
    onError(null); onNotice(null); setSaving(true)
    const result = await saveRolePermissions(role.id, perms)
    setSaving(false)
    if (result.error) return onError(result.error)
    onNotice(`Saved “${role.name}”. Changes apply on each user’s next action.`)
    onChanged()
  }

  async function handleRename() {
    onError(null); onNotice(null)
    const result = await renameRole(role.id, name, description)
    if (result.error) return onError(result.error)
    setRenaming(false)
    onNotice('Role updated.')
    onChanged()
  }

  async function handleDelete() {
    onError(null); onNotice(null)
    if (!confirm(`Delete the “${role.name}” role? This can’t be undone.`)) return
    const result = await deleteRole(role.id)
    if (result.error) return onError(result.error)
    onNotice(`Role “${role.name}” deleted.`)
    onChanged()
  }

  return (
    <div className="flex-1 min-w-0 w-full bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {renaming ? (
            <div className="space-y-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none"
              />
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none"
              />
              <div className="flex gap-2">
                <button onClick={handleRename} className="px-3 py-1.5 text-xs bg-navy text-white rounded-lg font-semibold">Save</button>
                <button onClick={() => { setRenaming(false); setName(role.name); setDescription(role.description || '') }} className="px-3 py-1.5 text-xs text-gray-600 rounded-lg hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <h3 className="text-lg font-bold text-navy">{role.name}</h3>
              {role.description && <p className="text-sm text-gray-500 mt-0.5">{role.description}</p>}
            </>
          )}
        </div>
        {!renaming && isOwner && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setRenaming(true)} className="px-3 py-1.5 text-xs text-navy border border-gray-200 rounded-lg hover:bg-gray-50">Edit</button>
            {!role.isSystem && (
              <button onClick={handleDelete} className="px-3 py-1.5 text-xs text-red-700 border border-red-200 rounded-lg hover:bg-red-50">Delete</button>
            )}
          </div>
        )}
      </div>

      {locked ? (
        <p className="mt-5 text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
          {role.isAdmin
            ? 'The Administrator role always has full access to everything and can’t be limited.'
            : isOwnRole
              ? 'You can’t edit the permissions of your own role. Ask another admin to do it.'
              : 'Only the account owner can change role permissions.'}
        </p>
      ) : (
        <div className="mt-5 space-y-6">
          <PermGroup title="What they can see" perms={seePerms} values={perms} onToggle={toggle} />
          <PermGroup title="What they can do" perms={doPerms} values={perms} onToggle={toggle} />

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="px-4 py-2 text-sm bg-navy text-white font-semibold rounded-lg hover:bg-navy/90 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PermGroup({
  title, perms, values, onToggle,
}: {
  title: string
  perms: PermissionDef[]
  values: Record<string, boolean>
  onToggle: (key: string) => void
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{title}</h4>
      <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
        {perms.map(p => {
          return (
            <label key={p.key} className="flex items-start gap-3 p-3.5 cursor-pointer hover:bg-gray-50">
              <button
                type="button"
                role="switch"
                aria-checked={!!values[p.key]}
                onClick={() => onToggle(p.key)}
                className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                  values[p.key] ? 'bg-mint' : 'bg-gray-200'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${values[p.key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy">{p.label}</p>
                <p className="text-xs text-gray-500">{p.description}</p>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function CreateRoleModal({
  onClose, onError, onCreated,
}: {
  onClose: () => void
  onError: (s: string | null) => void
  onCreated: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onError(null); setSaving(true)
    const result = await createRole(name, description)
    setSaving(false)
    if (result.error) return onError(result.error)
    onCreated(name.trim())
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <h3 className="text-base font-semibold text-navy">New role</h3>
            <label className="block text-sm text-gray-700 font-medium">
              Role name
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                required
                autoFocus
                placeholder="e.g. Front desk"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none font-normal"
              />
            </label>
            <label className="block text-sm text-gray-700 font-medium">
              Description (optional)
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none font-normal"
              />
            </label>
            <p className="text-xs text-gray-500">The new role starts with no permissions — turn on what it needs after creating it.</p>
          </div>
          <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-navy text-white text-sm font-semibold rounded-lg hover:bg-navy/90 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
