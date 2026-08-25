'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addStaff, updateStaffRole, setStaffActive, resendInvite, resetStaffPassword, updateStaffEmail } from '@/app/(app)/settings/users/actions'

interface StaffRow {
  id: string
  name: string
  email: string
  baseRole: string
  roleId: string | null
  roleName: string
  isAdmin: boolean
  isActive: boolean
  lastLoginAt: string | null
  isSelf: boolean
}

interface RoleOption {
  id: string
  name: string
  isAdmin: boolean
}

interface Props {
  staff: StaffRow[]
  roles: RoleOption[]
}

function formatLogin(iso: string | null): string {
  if (!iso) return 'Never signed in'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function UsersManager({ staff, roles }: Props) {
  const router = useRouter()
  const [showAdd, setShowAdd] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Add-user form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState(roles[0]?.id || '')
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Role-change confirmation state
  const [roleChange, setRoleChange] = useState<{
    userId: string
    userName: string
    fromRoleName: string
    toRoleId: string
    toRoleName: string
  } | null>(null)
  const [roleChangeReason, setRoleChangeReason] = useState('')
  const [roleChangeBusy, setRoleChangeBusy] = useState(false)

  // Email-change confirmation state
  const [emailChange, setEmailChange] = useState<{ userId: string; userName: string; fromEmail: string } | null>(null)
  const [emailChangeNewEmail, setEmailChangeNewEmail] = useState('')
  const [emailChangeReason, setEmailChangeReason] = useState('')
  const [emailChangeBusy, setEmailChangeBusy] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAdding(true)
    const result = await addStaff({ name, email, roleId })
    setAdding(false)
    if (result.error) return setError(result.error)
    setShowAdd(false)
    setName(''); setEmail(''); setRoleId(roles[0]?.id || '')
    setNotice(`Invite sent to ${email}.`)
    router.refresh()
  }

  function openRoleChange(u: StaffRow, newRoleId: string) {
    const toRole = roles.find(r => r.id === newRoleId)
    if (!toRole || newRoleId === u.roleId) return
    setError(null); setNotice(null)
    setRoleChangeReason('')
    setRoleChange({ userId: u.id, userName: u.name, fromRoleName: u.roleName, toRoleId: newRoleId, toRoleName: toRole.name })
  }

  async function confirmRoleChange(e: React.FormEvent) {
    e.preventDefault()
    if (!roleChange) return
    setRoleChangeBusy(true)
    const result = await updateStaffRole(roleChange.userId, roleChange.toRoleId, roleChangeReason)
    setRoleChangeBusy(false)
    if (result.error) return setError(result.error)
    setNotice(`${roleChange.userName}'s role changed to ${roleChange.toRoleName}.`)
    setRoleChange(null)
    router.refresh()
  }

  function openEmailChange(u: StaffRow) {
    setError(null); setNotice(null)
    setEmailChangeNewEmail(''); setEmailChangeReason('')
    setEmailChange({ userId: u.id, userName: u.name, fromEmail: u.email })
  }

  async function confirmEmailChange(e: React.FormEvent) {
    e.preventDefault()
    if (!emailChange) return
    setEmailChangeBusy(true)
    const result = await updateStaffEmail(emailChange.userId, emailChangeNewEmail, emailChangeReason)
    setEmailChangeBusy(false)
    if (result.error) return setError(result.error)
    setNotice(`${emailChange.userName}'s login email changed to ${emailChangeNewEmail}.`)
    setEmailChange(null)
    router.refresh()
  }

  async function handleToggleActive(id: string, active: boolean) {
    setError(null); setNotice(null); setBusyId(id)
    const result = await setStaffActive(id, active)
    setBusyId(null)
    if (result.error) return setError(result.error)
    router.refresh()
  }

  async function handleResend(id: string, email: string) {
    setError(null); setBusyId(id)
    const result = await resendInvite(id)
    setBusyId(null)
    if (result.error) return setError(result.error)
    setNotice(`Invite re-sent to ${email}.`)
  }

  async function handleResetPassword(id: string, email: string) {
    setError(null); setBusyId(id)
    const result = await resetStaffPassword(id)
    setBusyId(null)
    if (result.error) return setError(result.error)
    setNotice(`Password reset link sent to ${email}.`)
  }

  return (
    <div className="space-y-4">
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {notice && <div className="p-3 bg-mint-light border border-mint/30 rounded-lg text-sm text-navy">{notice}</div>}

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">{staff.length} {staff.length === 1 ? 'person' : 'people'} on your team</p>
        <button
          onClick={() => { setShowAdd(true); setError(null); setNotice(null) }}
          className="px-4 py-2 text-sm bg-navy text-white font-semibold rounded-lg hover:bg-navy/90"
        >
          Add user
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Last sign-in</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map(u => (
              <tr key={u.id} className="border-b border-gray-50 last:border-0">
                <td className="px-5 py-3">
                  <div className="font-medium text-navy">{u.name}{u.isSelf && <span className="text-xs text-gray-400 font-normal"> (you)</span>}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="px-5 py-3">
                  {/* Owner (school_admin) always keeps Administrator; can't be reassigned here. */}
                  {u.baseRole === 'school_admin' || u.baseRole === 'super_admin' ? (
                    <span className="text-gray-600">Administrator</span>
                  ) : u.isSelf ? (
                    <span className="text-gray-600">{u.roleName}</span>
                  ) : (
                    <select
                      value={u.roleId || ''}
                      onChange={e => openRoleChange(u, e.target.value)}
                      disabled={busyId === u.id}
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-navy focus:border-mint focus:outline-none disabled:opacity-50"
                    >
                      {!u.roleId && <option value="">— none —</option>}
                      {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{formatLogin(u.lastLoginAt)}</td>
                <td className="px-5 py-3">
                  {u.isActive ? (
                    <span className="text-xs px-2 py-0.5 bg-mint/10 text-mint rounded-full font-medium">Active</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">Deactivated</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {!u.lastLoginAt && u.isActive && (
                      <button
                        onClick={() => handleResend(u.id, u.email)}
                        disabled={busyId === u.id}
                        className="px-3 py-1.5 text-xs text-navy border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        Resend invite
                      </button>
                    )}
                    {!!u.lastLoginAt && u.isActive && (
                      <button
                        onClick={() => handleResetPassword(u.id, u.email)}
                        disabled={busyId === u.id}
                        className="px-3 py-1.5 text-xs text-navy border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        Reset password
                      </button>
                    )}
                    {!u.isSelf && u.baseRole !== 'school_admin' && u.baseRole !== 'super_admin' && (
                      <button
                        onClick={() => openEmailChange(u)}
                        disabled={busyId === u.id}
                        className="px-3 py-1.5 text-xs text-navy border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        Change email
                      </button>
                    )}
                    {!u.isSelf && (
                      u.isActive ? (
                        <button
                          onClick={() => handleToggleActive(u.id, false)}
                          disabled={busyId === u.id}
                          className="px-3 py-1.5 text-xs text-red-700 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggleActive(u.id, true)}
                          disabled={busyId === u.id}
                          className="px-3 py-1.5 text-xs text-mint border border-mint/30 rounded-lg hover:bg-mint/5 disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <form onSubmit={handleAdd}>
              <div className="p-6 space-y-4">
                <h3 className="text-base font-semibold text-navy">Add a team member</h3>
                <p className="text-xs text-gray-500 -mt-2">They&apos;ll get an email to set their password and sign in.</p>

                <label className="block text-sm text-gray-700 font-medium">
                  Full name
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none font-normal"
                  />
                </label>
                <label className="block text-sm text-gray-700 font-medium">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none font-normal"
                  />
                </label>
                <label className="block text-sm text-gray-700 font-medium">
                  Role
                  <select
                    value={roleId}
                    onChange={e => setRoleId(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-navy focus:border-mint focus:outline-none"
                  >
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>

                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
              <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setError(null) }}
                  disabled={adding}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="px-4 py-2 bg-navy text-white text-sm font-semibold rounded-lg hover:bg-navy/90 disabled:opacity-50"
                >
                  {adding ? 'Sending invite…' : 'Send invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {roleChange && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <form onSubmit={confirmRoleChange}>
              <div className="p-6 space-y-4">
                <h3 className="text-base font-semibold text-navy">Change {roleChange.userName}&apos;s role?</h3>
                <p className="text-sm text-gray-600 -mt-2">
                  From <span className="font-medium text-navy">{roleChange.fromRoleName}</span> to{' '}
                  <span className="font-medium text-navy">{roleChange.toRoleName}</span>.
                </p>

                <label className="block text-sm text-gray-700 font-medium">
                  Reason for this change
                  <textarea
                    value={roleChangeReason}
                    onChange={e => setRoleChangeReason(e.target.value)}
                    required
                    rows={3}
                    placeholder="e.g. Promoted to head bursar duties"
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none font-normal"
                  />
                </label>

                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
              <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setRoleChange(null); setError(null) }}
                  disabled={roleChangeBusy}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={roleChangeBusy || !roleChangeReason.trim()}
                  className="px-4 py-2 bg-navy text-white text-sm font-semibold rounded-lg hover:bg-navy/90 disabled:opacity-50"
                >
                  {roleChangeBusy ? 'Changing…' : 'Confirm change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {emailChange && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <form onSubmit={confirmEmailChange}>
              <div className="p-6 space-y-4">
                <h3 className="text-base font-semibold text-navy">Change {emailChange.userName}&apos;s login email?</h3>
                <p className="text-sm text-gray-600 -mt-2">
                  Currently <span className="font-medium text-navy">{emailChange.fromEmail}</span>. This takes effect
                  immediately — no confirmation link, since you&apos;re making this change on their behalf. Both the old
                  and new address get notified.
                </p>

                <label className="block text-sm text-gray-700 font-medium">
                  New email
                  <input
                    type="email"
                    value={emailChangeNewEmail}
                    onChange={e => setEmailChangeNewEmail(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none font-normal"
                  />
                </label>
                <label className="block text-sm text-gray-700 font-medium">
                  Reason for this change
                  <textarea
                    value={emailChangeReason}
                    onChange={e => setEmailChangeReason(e.target.value)}
                    required
                    rows={3}
                    placeholder="e.g. Staff member's old email was deactivated by their employer"
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-mint focus:outline-none font-normal"
                  />
                </label>

                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
              <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setEmailChange(null); setError(null) }}
                  disabled={emailChangeBusy}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={emailChangeBusy || !emailChangeNewEmail.trim() || !emailChangeReason.trim()}
                  className="px-4 py-2 bg-navy text-white text-sm font-semibold rounded-lg hover:bg-navy/90 disabled:opacity-50"
                >
                  {emailChangeBusy ? 'Changing…' : 'Confirm change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
