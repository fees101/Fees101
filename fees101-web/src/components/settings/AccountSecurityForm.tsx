'use client'

import { useState } from 'react'
import { changePassword } from '@/app/(app)/team/account-security/actions'
import Toast from '@/components/ui/Toast'

type RowKey = 'password'

export default function AccountSecurityForm() {
  const [editing, setEditing] = useState<RowKey | null>(null)
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function openEdit() {
    setError(null)
    setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setEditing('password')
  }

  function cancelEdit() {
    setEditing(null)
    setError(null)
  }

  async function handleSubmit() {
    setError(null)

    if (!form.currentPassword) return setError('Current password is required')
    if (form.newPassword.length < 8) return setError('New password must be at least 8 characters')
    if (form.newPassword !== form.confirmPassword) return setError('New passwords do not match')

    setSaving(true)
    const result = await changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    })
    setSaving(false)

    if (result.error) {
      setError(result.error)
      return
    }
    setEditing(null)
    setSaved(true)
  }

  return (
    <>
      <div style={{ borderTop: '2px solid var(--color-ink)', paddingTop: 18 }}>
        <h2 className="text-2xl font-extrabold tracking-[-0.015em] text-[var(--color-ink)]" style={{ margin: 0 }}>
          Account security
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-800)]" style={{ maxWidth: '74ch', marginTop: 8 }}>
          Your own sign-in, and the rules that apply to everyone at this school.
        </p>
      </div>

      <div style={{ marginTop: 8 }}>
        <SettingRow
          label="Your password"
          desc="Use at least 8 characters. You'll stay signed in on this device."
          value="••••••••••"
          action="CHANGE"
          editing={editing === 'password'}
          onEdit={openEdit}
          onCancel={cancelEdit}
          onSave={handleSubmit}
          saving={saving}
          error={error}
        >
          <div className="space-y-3 max-w-sm">
            <label className="block">
              <span className="m-label">Current password</span>
              <input
                type="password"
                value={form.currentPassword}
                onChange={(e) => setForm(f => ({ ...f, currentPassword: e.target.value }))}
                className="m-input"
                autoComplete="current-password"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="m-label">New password</span>
              <input
                type="password"
                value={form.newPassword}
                onChange={(e) => setForm(f => ({ ...f, newPassword: e.target.value }))}
                className="m-input"
                autoComplete="new-password"
              />
            </label>
            <label className="block">
              <span className="m-label">Confirm new password</span>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                className="m-input"
                autoComplete="new-password"
              />
            </label>
          </div>
        </SettingRow>

        {/* Two-factor authentication, its all-staff counterpart, active
            sessions and sign-in alerts are drawn in the design but have no
            feature behind them yet — shown as transparent FIXED rows rather
            than built, per the "do not invent a query/feature" rule. */}
        <SettingRow
          label="Two-factor authentication"
          desc="A code by SMS in addition to your password"
          value="Not built yet"
          action="FIXED"
        />
        <SettingRow
          label="Require 2FA for all staff"
          desc="Applies to anyone who can move money"
          value="Not built yet"
          action="FIXED"
        />
        <SettingRow
          label="Active sessions"
          desc="Devices currently signed in as you"
          value="Not built yet"
          action="FIXED"
        />
        <SettingRow
          label="Sign-in alerts"
          desc="Email you when a new device signs in"
          value="Not built yet"
          action="FIXED"
        />
      </div>

      {saved && (
        <Toast message="Password updated." ok onDismiss={() => setSaved(false)} />
      )}
    </>
  )
}

// Shares the School-profile ledger geometry (.m-setrow): label + description
// left, current value on the aligned column, action word flush right
// (CHANGE opens the inline editor, FIXED is inert), or the editor spanning
// the value column when open.
function SettingRow({
  label, desc, value, action, editing, onEdit, onCancel, onSave, saving, error, children,
}: {
  label: string
  desc: string
  value: string
  action: 'CHANGE' | 'FIXED'
  editing?: boolean
  onEdit?: () => void
  onCancel?: () => void
  onSave?: () => void
  saving?: boolean
  error?: string | null
  children?: React.ReactNode
}) {
  return (
    <div className="m-setrow">
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-ink)', margin: 0 }}>{label}</p>
        <p className="text-[13px] text-[var(--color-neutral-700)]" style={{ margin: '4px 0 0' }}>{desc}</p>
      </div>

      {editing ? (
        <div style={{ minWidth: 0 }}>
          {children}
          {error && (
            <div className="mt-3 p-3 text-sm text-[var(--color-signal-text)]" style={{ background: 'var(--color-signal-100)', borderLeft: '3px solid var(--color-signal)' }}>
              {error}
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button onClick={onSave} disabled={saving} className="m-btn m-btn-primary">{saving ? 'Updating...' : 'Update password'}</button>
            <button onClick={onCancel} disabled={saving} className="m-btn m-btn-outline">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="m-setrow__side">
          <p className="text-[15px] text-[var(--color-ink)]" style={{ margin: 0, minWidth: 0, wordBreak: 'break-word' }}>{value}</p>
          {action === 'FIXED' ? (
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-neutral-500)', whiteSpace: 'nowrap' }}>FIXED</span>
          ) : (
            <button onClick={onEdit} style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-ink)', whiteSpace: 'nowrap' }} className="hover:text-[var(--color-signal-text)]">
              {action}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
