'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addStaff, updateStaffRole, setStaffActive, resendInvite, resetStaffPassword, updateStaffEmail } from '@/app/(app)/team/users/actions'
import { formatDate } from '@/lib/format/date'
import Toast from '@/components/ui/Toast'
import { SectionLabel, ChoiceList } from '@/components/settings/FieldEditDrawer'
import DestructiveConfirmModal from '@/components/ui/DestructiveConfirmModal'

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
  isOwner: boolean
}

function formatLogin(iso: string | null): string {
  if (!iso) return 'Never signed in'
  return formatDate(iso)
}

// The App Shell canvas's exact vocabulary for "how long ago" a person was
// last seen — full words, not abbreviations, up to a few weeks out, then it
// falls back to a plain date rather than "12 weeks ago" reading as vague.
function timeAgoLogin(iso: string | null): string {
  if (!iso) return 'Never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  if (mins < 2) return 'Now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  if (days === 1) return 'Yesterday'
  if (days < 14) return `${days} days ago`
  if (weeks < 8) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  return formatDate(iso)
}

// A DORMANT account still has full access but hasn't been used in a while —
// worth flagging distinctly from a genuinely active one, per the App Shell
// canvas ("Mrs Eze has not signed in for three weeks but still has access to
// every student record."). Two weeks is long enough to be worth a second
// look without flagging someone back from a routine short break.
const DORMANT_AFTER_DAYS = 14
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

// Status by label and colour weight, not a pill: ochre for one still awaiting
// its first sign-in or gone quiet, muted neutral for a deactivated account (an
// intentional off-state), plain ink for a genuinely active, recently-used
// account — ledger green is reserved for money that has arrived, never an
// account-status word.
function StatusText({ isActive, lastLoginAt }: { isActive: boolean; lastLoginAt: string | null }) {
  const { label, color } = !isActive
    ? { label: 'DEACTIVATED', color: 'var(--color-neutral-500)' }
    : !lastLoginAt
      ? { label: 'INVITED', color: 'var(--color-ochre-text)' }
      : daysSince(lastLoginAt) >= DORMANT_AFTER_DAYS
        ? { label: 'DORMANT', color: 'var(--color-ochre-text)' }
        : { label: 'ACTIVE', color: 'var(--color-ink)' }
  return (
    <span className="text-xs font-semibold" style={{ letterSpacing: '0.08em', color }}>
      {label}
    </span>
  )
}

// A staff member the owner (or a delegated admin) can't reassign or remove —
// the literal school_admin/super_admin owner row. Everything else in the
// manage drawer is conditioned on this and on `isSelf`.
function isLockedOwnerRow(u: StaffRow): boolean {
  return u.baseRole === 'school_admin' || u.baseRole === 'super_admin'
}

export default function UsersManager({ staff, roles, isOwner }: Props) {
  const router = useRouter()
  const [showAdd, setShowAdd] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Add-user form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState(roles[0]?.id || '')
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Manage-staff drawer — one drawer per row, holding every action (role,
  // reset password/resend invite, change email, deactivate/reactivate) that
  // used to be scattered across the row's action buttons plus two separate
  // centered confirmation modals. Keyed by id rather than holding a snapshot
  // of the row, so it reflects `staff` as soon as router.refresh() lands a
  // change (role name, status, email) without needing to be closed first.
  const [managingId, setManagingId] = useState<string | null>(null)
  const managing = staff.find(u => u.id === managingId) || null

  const [roleSelect, setRoleSelect] = useState('')
  const [roleReason, setRoleReason] = useState('')
  const [roleBusy, setRoleBusy] = useState(false)
  const [roleMsg, setRoleMsg] = useState<string | null>(null)

  const [emailValue, setEmailValue] = useState('')
  const [emailReason, setEmailReason] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMsg, setEmailMsg] = useState<string | null>(null)

  // Feedback for the drawer's one-click actions (reset password/resend
  // invite in Sign-in, deactivate/reactivate in Access) — kept separate so a
  // message from one section never shows up under the other once busyAction
  // resets to null after either completes.
  const [signinMsg, setSigninMsg] = useState<string | null>(null)
  const [accessMsg, setAccessMsg] = useState<string | null>(null)

  // Deactivating fires immediately with nothing to undo but "Reactivate" — a
  // spelled-out confirm step, not a schema change, so no consequence rows
  // beyond restating what the drawer's own copy already says.
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  // A modal already surfaces its own inline error while it's open - the
  // top-level toast only needs to fire once everything is closed again.
  const modalOpen = showAdd || !!managingId

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

  function openManage(u: StaffRow) {
    setError(null); setNotice(null)
    setRoleSelect(u.roleId || '')
    setRoleReason(''); setRoleMsg(null)
    setEmailValue(''); setEmailReason(''); setEmailMsg(null)
    setSigninMsg(null); setAccessMsg(null)
    setManagingId(u.id)
  }

  function closeManage() {
    setManagingId(null)
    setError(null)
    setConfirmDeactivate(false)
  }

  async function submitRoleChange(e: React.FormEvent) {
    e.preventDefault()
    if (!managing) return
    setError(null)
    setRoleBusy(true)
    const result = await updateStaffRole(managing.id, roleSelect, roleReason)
    setRoleBusy(false)
    if (result.error) return setError(result.error)
    const toRole = roles.find(r => r.id === roleSelect)
    setRoleReason('')
    setRoleMsg(`Role changed to ${toRole?.name || 'the selected role'}.`)
    router.refresh()
  }

  async function submitEmailChange(e: React.FormEvent) {
    e.preventDefault()
    if (!managing) return
    setError(null)
    setEmailBusy(true)
    const result = await updateStaffEmail(managing.id, emailValue, emailReason)
    setEmailBusy(false)
    if (result.error) return setError(result.error)
    setEmailMsg(`Login email changed to ${emailValue}.`)
    setEmailValue(''); setEmailReason('')
    router.refresh()
  }

  async function handleToggleActive(id: string, active: boolean) {
    if (!active) {
      setConfirmDeactivate(true)
      return
    }
    setError(null); setAccessMsg(null); setBusyId(id); setBusyAction('reactivate')
    const result = await setStaffActive(id, true)
    setBusyId(null); setBusyAction(null)
    if (result.error) return setError(result.error)
    setAccessMsg('Reactivated.')
    router.refresh()
  }

  async function confirmDeactivateStaff() {
    if (!managing) return
    setError(null); setAccessMsg(null); setBusyId(managing.id); setBusyAction('deactivate')
    const result = await setStaffActive(managing.id, false)
    setBusyId(null); setBusyAction(null)
    if (result.error) { setError(result.error); return }
    setConfirmDeactivate(false)
    setAccessMsg('Deactivated.')
    router.refresh()
  }

  async function handleResend(id: string, email: string) {
    setError(null); setSigninMsg(null); setBusyId(id); setBusyAction('resend')
    const result = await resendInvite(id)
    setBusyId(null); setBusyAction(null)
    if (result.error) return setError(result.error)
    setSigninMsg(`Invite re-sent to ${email}.`)
  }

  async function handleResetPassword(id: string, email: string) {
    setError(null); setSigninMsg(null); setBusyId(id); setBusyAction('reset')
    const result = await resetStaffPassword(id)
    setBusyId(null); setBusyAction(null)
    if (result.error) return setError(result.error)
    setSigninMsg(`Password reset link sent to ${email}.`)
  }

  return (
    <div>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Staff with access
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          <span className="m-num">{staff.length}</span> {staff.length === 1 ? 'person can' : 'people can'} sign in.
          Removing someone revokes access immediately but keeps their name on everything they did.
        </p>
      </div>

      <div className="pt-6 pb-4 mb-4 border-b border-[var(--color-neutral-300)] flex items-center justify-end gap-4">
        <button
          onClick={() => { setShowAdd(true); setError(null); setNotice(null) }}
          className="m-btn m-btn-primary"
        >
          Invite staff
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="m-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th className="whitespace-nowrap">Last seen</th>
              <th>State</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map(u => (
              <tr key={u.id}>
                <td>
                  <p className="font-semibold text-[var(--color-ink)]">
                    {u.name}{u.isSelf && <span className="text-xs text-[var(--color-neutral-500)] font-normal"> (you)</span>}
                  </p>
                  <p className="text-xs text-[var(--color-neutral-700)]">{u.email}</p>
                </td>
                <td className="text-[var(--color-neutral-700)]">
                  {isLockedOwnerRow(u) ? 'Administrator' : u.roleName}
                </td>
                <td className="text-[var(--color-neutral-700)] whitespace-nowrap m-num" title={formatLogin(u.lastLoginAt)}>{timeAgoLogin(u.lastLoginAt)}</td>
                <td>
                  <StatusText isActive={u.isActive} lastLoginAt={u.lastLoginAt} />
                </td>
                <td className="text-right">
                  <button
                    onClick={() => openManage(u)}
                    className="m-btn m-btn-outline m-btn-sm"
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex m-anim-fade">
          <div className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]" onClick={() => { setShowAdd(false); setError(null) }} />
          <aside
            style={{ width: '420px', maxWidth: '100%' }}
            className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
          >
            <form onSubmit={handleAdd}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">Add a team member</h2>
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setError(null) }}
                  aria-label="Close"
                  className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
                >
                  Close
                </button>
              </div>
              <p className="text-[13px] leading-relaxed mb-5 text-[var(--color-neutral-700)]">
                They&apos;ll get an email to set their password and sign in. What they can do once inside is entirely
                down to the role you give them here.
              </p>

              <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <SectionLabel>Full name</SectionLabel>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    autoFocus
                    className="m-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ marginBottom: 18 }}>
                  <SectionLabel>Email</SectionLabel>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="m-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 14, marginBottom: 18 }}>
                  <SectionLabel>Role</SectionLabel>
                  <ChoiceList
                    value={roleId}
                    onChange={setRoleId}
                    options={roles.map(r => ({ value: r.id, label: r.name }))}
                  />
                  <p className="text-[12px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0', lineHeight: 1.45 }}>
                    A role can be changed later from this same table — nothing here is permanent.
                  </p>
                </div>

                {error && (
                  <div className="p-3 mb-4 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
                    {error}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={adding}
                  className="m-btn m-btn-primary"
                >
                  {adding ? 'Sending invite...' : 'Send invite'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setError(null) }}
                  disabled={adding}
                  className="m-btn m-btn-outline"
                >
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {managing && (() => {
        const busy = busyId === managing.id
        const locked = isLockedOwnerRow(managing)
        const canEditEmailOrAccess = !managing.isSelf && !locked
        const canDeactivate = canEditEmailOrAccess && (isOwner || !managing.isAdmin)
        const roleChanged = roleSelect !== (managing.roleId || '')
        return (
          <div className="fixed inset-0 z-50 flex m-anim-fade">
            <div className="flex-1 bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]" onClick={closeManage} />
            <aside
              style={{ width: '420px', maxWidth: '100%' }}
              className="h-full overflow-y-auto bg-[var(--color-paper)] border-l-2 border-[var(--color-ink)] p-[22px] m-anim-slide"
            >
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-[var(--color-ink)]">
                  {managing.name}{managing.isSelf && <span className="text-[14px] text-[var(--color-neutral-500)] font-normal"> (you)</span>}
                </h2>
                <button
                  type="button"
                  onClick={closeManage}
                  aria-label="Close"
                  className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-signal-text)] hover:underline"
                >
                  Close
                </button>
              </div>
              <p className="text-[13px] leading-relaxed mb-5 text-[var(--color-neutral-700)]">
                {managing.email}
              </p>

              <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 16 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
                  <SectionLabel>Status</SectionLabel>
                  <StatusText isActive={managing.isActive} lastLoginAt={managing.lastLoginAt} />
                </div>

                {/* Role — the owner row is always Administrator and can't be
                    reassigned here; a person can't change their own role. */}
                <div style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 16, marginBottom: 18 }}>
                  <SectionLabel>Role</SectionLabel>
                  {locked ? (
                    <p className="text-[14px] text-[var(--color-neutral-700)]" style={{ margin: 0 }}>Administrator — can&apos;t be reassigned.</p>
                  ) : managing.isSelf ? (
                    <p className="text-[14px] text-[var(--color-neutral-700)]" style={{ margin: 0 }}>{managing.roleName} — you can&apos;t change your own role.</p>
                  ) : (
                    <form onSubmit={submitRoleChange}>
                      <ChoiceList
                        value={roleSelect}
                        onChange={setRoleSelect}
                        options={roles.map(r => ({ value: r.id, label: r.name }))}
                      />
                      {roleChanged && (
                        <div style={{ marginTop: 10 }}>
                          <textarea
                            value={roleReason}
                            onChange={e => setRoleReason(e.target.value)}
                            required
                            rows={2}
                            placeholder="Reason for this change"
                            className="m-textarea"
                          />
                          <button
                            type="submit"
                            disabled={roleBusy || !roleReason.trim()}
                            className="m-btn m-btn-primary m-btn-sm"
                            style={{ marginTop: 8 }}
                          >
                            {roleBusy ? 'Changing...' : 'Save role'}
                          </button>
                        </div>
                      )}
                      {roleMsg && <p className="text-[12px]" style={{ color: 'var(--color-ink)', marginTop: 8 }}>{roleMsg}</p>}
                    </form>
                  )}
                </div>

                {/* Sign-in — one or the other is always available for an
                    active account: Resend invite before first sign-in,
                    Reset password after. Nothing to do here once deactivated. */}
                <div style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 16, marginBottom: 18 }}>
                  <SectionLabel>Sign-in</SectionLabel>
                  {!managing.isActive ? (
                    <p className="text-[14px] text-[var(--color-neutral-700)]" style={{ margin: 0 }}>Deactivated — sign-in is disabled.</p>
                  ) : !managing.lastLoginAt ? (
                    <button
                      onClick={() => handleResend(managing.id, managing.email)}
                      disabled={busy}
                      className="m-btn m-btn-outline m-btn-sm"
                    >
                      {busy && busyAction === 'resend' ? 'Sending...' : 'Resend invite'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleResetPassword(managing.id, managing.email)}
                      disabled={busy}
                      className="m-btn m-btn-outline m-btn-sm"
                    >
                      {busy && busyAction === 'reset' ? 'Sending...' : 'Reset password'}
                    </button>
                  )}
                  {signinMsg && (
                    <p className="text-[12px]" style={{ color: 'var(--color-ink)', marginTop: 8 }}>{signinMsg}</p>
                  )}
                </div>

                {/* Login email — never for self or the owner row, matching
                    updateStaffEmail's own server-side guard. */}
                {canEditEmailOrAccess && (
                  <form onSubmit={submitEmailChange} style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 16, marginBottom: 18 }}>
                    <SectionLabel>Login email</SectionLabel>
                    <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '0 0 8px' }}>
                      Takes effect immediately — no confirmation link, since you&apos;re making this change on their
                      behalf. Both the old and new address get notified.
                    </p>
                    <input
                      type="email"
                      value={emailValue}
                      onChange={e => setEmailValue(e.target.value)}
                      placeholder="New email"
                      className="m-input"
                      style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
                    />
                    <textarea
                      value={emailReason}
                      onChange={e => setEmailReason(e.target.value)}
                      rows={2}
                      placeholder="Reason for this change"
                      className="m-textarea"
                      style={{ marginBottom: 8 }}
                    />
                    <button
                      type="submit"
                      disabled={emailBusy || !emailValue.trim() || !emailReason.trim()}
                      className="m-btn m-btn-outline m-btn-sm"
                    >
                      {emailBusy ? 'Changing...' : 'Change email'}
                    </button>
                    {emailMsg && <p className="text-[12px]" style={{ color: 'var(--color-ink)', marginTop: 8 }}>{emailMsg}</p>}
                  </form>
                )}

                {/* Access — a delegated Administrator can only be deactivated
                    by the owner; the owner's own row is never reachable here. */}
                {canDeactivate && (
                  <div style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 16, marginBottom: 18 }}>
                    <SectionLabel>Access</SectionLabel>
                    {managing.isActive ? (
                      <button
                        onClick={() => handleToggleActive(managing.id, false)}
                        disabled={busy}
                        className="m-btn m-btn-danger m-btn-sm"
                      >
                        {busy && busyAction === 'deactivate' ? 'Deactivating...' : 'Deactivate'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggleActive(managing.id, true)}
                        disabled={busy}
                        className="m-btn m-btn-outline m-btn-sm"
                      >
                        {busy && busyAction === 'reactivate' ? 'Reactivating...' : 'Reactivate'}
                      </button>
                    )}
                    {accessMsg && (
                      <p className="text-[12px]" style={{ color: 'var(--color-ink)', marginTop: 8 }}>{accessMsg}</p>
                    )}
                  </div>
                )}

                {error && (
                  <div className="p-3 mb-4 bg-[var(--color-signal-100)] border-l-[3px] border-[var(--color-signal)] text-sm text-[var(--color-signal-text)]">
                    {error}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )
      })()}

      {!modalOpen && (notice || error) && (
        <Toast
          message={(notice || error) as string}
          ok={!!notice}
          onDismiss={() => { setNotice(null); setError(null) }}
        />
      )}

      {confirmDeactivate && managing && (() => {
        const busy = busyId === managing.id
        return (
          <DestructiveConfirmModal
            title={`Deactivate ${managing.name}?`}
            description="They immediately lose the ability to sign in. Nothing else about their account changes, and it's reversible any time from this same drawer."
            rows={[{ label: 'Role', value: managing.roleName }, { label: 'Login email', value: managing.email }]}
            note="Reactivate anytime — role, permissions, and history all stay exactly as they are."
            error={error}
            actions={[
              { label: 'Cancel', onClick: () => setConfirmDeactivate(false), variant: 'outline', disabled: busy },
              { label: busy && busyAction === 'deactivate' ? 'Deactivating...' : 'Deactivate', onClick: confirmDeactivateStaff, variant: 'danger', disabled: busy },
            ]}
          />
        )
      })()}
    </div>
  )
}
